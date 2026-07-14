import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Use large json limit since we transmit base64 images
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Lazy init of GoogleGenAI SDK helper
function getGoogleGenAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not defined");
  }
  return new GoogleGenAI({ apiKey });
}

// 1. POST /api/extract-table
app.post("/api/extract-table", async (req, res) => {
  try {
    const { resultsScreenshots, sources, overrides } = req.body;

    if (!resultsScreenshots || !Array.isArray(resultsScreenshots) || resultsScreenshots.length === 0) {
      return res.status(400).json({ error: "Missing resultsScreenshots array" });
    }

    const ai = getGoogleGenAI();

    // Prepare content parts for Gemini
    const contents: any[] = [];

    // System instruction
    const systemInstruction = `You are an elite research analyst for Turtle Wealth, a prestigious Portfolio Management Service (PMS) in India.
Your job is to read screenshots of corporate quarterly earnings (consolidated tables, balance sheets, profit & loss, segmental reports) and optional source documents/texts, and produce a structured, high-accuracy financial metric list in JSON.

Strict compliance rules:
1. Extract the actual numbers accurately. Check the decimal position and the unit (usually ₹ CR. or standard Crore/Lakh). Convert Lakh to Crore (1 Crore = 100 Lakhs) if needed, keeping consistency with the Unit.
2. If the user provided custom overrides (company name, period), use them verbatim.
3. Determine whether the metric is a percentage/ratio (is_ratio = true) such as Net NPA %, Operating Margin %, Gross NPA %, Capital Adequacy %, NIM %, ROA %, cost to income, etc.
4. For ratios/margins/percentages, the YoY and QoQ values should be computed as basis points (bps) difference (e.g. current - previous). Mark 'is_ratio = true'.
5. For absolute amounts (like Revenue, EBITDA, PAT, Net Profit, NII, Advances, Deposits, etc.), mark 'is_ratio = false'. YoY and QoQ will be percentage changes.
6. Determine if lower is better (e.g. Gross NPA %, Net NPA %, Slippages, Operating Expenses, Cost to Income Ratio should be 'lower_is_better = true'). For standard positive items (PAT, Revenues, EBITDA, margins, etc.), 'lower_is_better = false'.
7. Output exactly the requested JSON format. Do not wrap the JSON in Markdown backticks. Provide clean, parser-friendly JSON.`;

    // Add prompt instructions
    let userPrompt = `Extract the core financial results metrics.
Company Name Override: ${overrides?.companyName || "None"}
Period Override: ${overrides?.period || "None"}

Please look closely at the provided screenshots. Focus on extracting:
- Revenue / Total Income
- EBITDA / Operating Profit
- PAT / Net Profit
- Margins or other key sector-specific ratios (like Gross NPA, Net NPA, NIM for Banks/NBFCs) if clearly visible.

Analyze the documents and images, compile a metric list, and respond with a JSON object of this structure:
{
  "company": "Company Name",
  "period": "Period (e.g., Q1 FY27)",
  "unit": "₹ CR.",
  "col_current": "Current Quarter Period Name",
  "col_prev_q": "Previous Quarter Period Name",
  "col_prev_y": "Previous Year Quarter Period Name",
  "metrics": [
    {
      "label": "Revenue",
      "current": 1250.5,
      "prev_q": 1180.2,
      "prev_y": 1050.0,
      "is_ratio": false,
      "lower_is_better": false,
      "decimals": 1
    },
    ...
  ]
}

Ensure all number fields are numeric or null if completely missing. Do not use string values for numeric fields.`;

    contents.push(userPrompt);

    // Attach results screenshots
    for (const shot of resultsScreenshots) {
      if (shot.data && shot.mimeType) {
        // Strip data:image/...;base64, if present
        const base64Data = shot.data.includes("base64,")
          ? shot.data.split("base64,")[1]
          : shot.data;
        contents.push({
          inlineData: {
            data: base64Data,
            mimeType: shot.mimeType,
          },
        });
      }
    }

    // Attach any source documents or text
    if (sources) {
      let sourceText = "";
      if (sources.quarterlyResults?.text) {
        sourceText += `\n--- SOURCE: Quarterly Results Text ---\n${sources.quarterlyResults.text}\n`;
      }
      if (sources.quarterlyResults?.file) {
        const fileData = sources.quarterlyResults.file.data.includes("base64,")
          ? sources.quarterlyResults.file.data.split("base64,")[1]
          : sources.quarterlyResults.file.data;
        contents.push({
          inlineData: {
            data: fileData,
            mimeType: sources.quarterlyResults.file.mimeType,
          },
        });
      }

      if (sources.investorPresentation?.text) {
        sourceText += `\n--- SOURCE: Investor Presentation Text ---\n${sources.investorPresentation.text}\n`;
      }
      if (sources.investorPresentation?.file) {
        const fileData = sources.investorPresentation.file.data.includes("base64,")
          ? sources.investorPresentation.file.data.split("base64,")[1]
          : sources.investorPresentation.file.data;
        contents.push({
          inlineData: {
            data: fileData,
            mimeType: sources.investorPresentation.file.mimeType,
          },
        });
      }

      if (sources.pressRelease?.text) {
        sourceText += `\n--- SOURCE: Press Release Text ---\n${sources.pressRelease.text}\n`;
      }
      if (sources.pressRelease?.file) {
        const fileData = sources.pressRelease.file.data.includes("base64,")
          ? sources.pressRelease.file.data.split("base64,")[1]
          : sources.pressRelease.file.data;
        contents.push({
          inlineData: {
            data: fileData,
            mimeType: sources.pressRelease.file.mimeType,
          },
        });
      }

      if (sourceText.trim()) {
        contents.push(sourceText);
      }
    }

    // Call Gemini with the recommended "gemini-3.5-flash" model
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
      },
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("No response received from Gemini API");
    }

    const parsedJson = JSON.parse(responseText.trim());
    return res.json(parsedJson);
  } catch (error: any) {
    console.error("Extract Table Error:", error);
    return res.status(500).json({ error: error.message || "Failed to parse screenshot data" });
  }
});

// 2. POST /api/write-commentary
app.post("/api/write-commentary", async (req, res) => {
  try {
    const { tableData, resultsScreenshots, sources, fund, scoreText } = req.body;

    if (!tableData) {
      return res.status(400).json({ error: "Missing tableData" });
    }

    const ai = getGoogleGenAI();

    // Prepare system instruction
    const systemInstruction = `You are an elite, highly sophisticated Senior PMS (Portfolio Management Service) Investment Advisor writing premium, institutional-grade quarterly results summaries for Turtle Wealth's elite client base.

Your commentary must be:
1. Highly insightful, professional, clean, objective, and mature. Speak with absolute authority and deep financial intellect.
2. Directly linked to the provided confirmed numbers from the table. Do not contradict or deviate from the table metrics.
3. Balanced: Highlight key tailwinds/strengths and headwind challenges. Discuss both the top-line (Revenue/Interest Income) and bottom-line (Profitability, Margins, credit costs) performance.
4. Actionable: Weave in the sentiment of the hold status provided in "${scoreText}". Explain clearly why we are holding, reviewing, or seeking alternatives, linking it logically to their operational performance or industry dynamics.
5. Structured as exactly 4 key bullet points, each containing 2-3 detailed sentences. Provide deep financial analysis, not generic statements. Do not add bold headers inside bullet points. Just output raw, high-quality bullet point strings inside the JSON array.
6. Response format: JSON with a single "highlights" key containing an array of 4 strings. No markdown formatting.`;

    const contents: any[] = [];

    const userPrompt = `Formulate 4 key investment commentary bullet points for:
Company: ${tableData.company}
Period: ${tableData.period}
Fund/Portfolio: ${fund}
Turtle Scorecard Hold Statement: "${scoreText}"

Table Metrics:
${JSON.stringify(tableData.metrics, null, 2)}

Provide deep, sector-specific insight. If this is a bank, talk about NIM, credit costs, asset quality (GNPA/NNPA) and deposit traction. If it's an IT or manufacturing company, discuss order pipelines, execution, margin pressure, and pricing power. Ensure each bullet point is polished and represents elite advisory.

Return format:
{
  "highlights": [
    "Sentence 1 of first point. Sentence 2 of first point.",
    "Sentence 1 of second point. Sentence 2 of second point.",
    "Sentence 1 of third point. Sentence 2 of third point.",
    "Sentence 1 of fourth point. Sentence 2 of fourth point."
  ]
}`;

    contents.push(userPrompt);

    // Attach results screenshots & source documents for deep context if available
    if (resultsScreenshots && Array.isArray(resultsScreenshots)) {
      for (const shot of resultsScreenshots) {
        if (shot.data && shot.mimeType) {
          const base64Data = shot.data.includes("base64,")
            ? shot.data.split("base64,")[1]
            : shot.data;
          contents.push({
            inlineData: {
              data: base64Data,
              mimeType: shot.mimeType,
            },
          });
        }
      }
    }

    if (sources) {
      let sourceText = "";
      if (sources.quarterlyResults?.text) {
        sourceText += `\n--- SOURCE: Quarterly Results Text ---\n${sources.quarterlyResults.text}\n`;
      }
      if (sources.quarterlyResults?.file) {
        const fileData = sources.quarterlyResults.file.data.includes("base64,")
          ? sources.quarterlyResults.file.data.split("base64,")[1]
          : sources.quarterlyResults.file.data;
        contents.push({
          inlineData: {
            data: fileData,
            mimeType: sources.quarterlyResults.file.mimeType,
          },
        });
      }

      if (sources.investorPresentation?.text) {
        sourceText += `\n--- SOURCE: Investor Presentation Text ---\n${sources.investorPresentation.text}\n`;
      }
      if (sources.investorPresentation?.file) {
        const fileData = sources.investorPresentation.file.data.includes("base64,")
          ? sources.investorPresentation.file.data.split("base64,")[1]
          : sources.investorPresentation.file.data;
        contents.push({
          inlineData: {
            data: fileData,
            mimeType: sources.investorPresentation.file.mimeType,
          },
        });
      }

      if (sources.pressRelease?.text) {
        sourceText += `\n--- SOURCE: Press Release Text ---\n${sources.pressRelease.text}\n`;
      }
      if (sources.pressRelease?.file) {
        const fileData = sources.pressRelease.file.data.includes("base64,")
          ? sources.pressRelease.file.data.split("base64,")[1]
          : sources.pressRelease.file.data;
        contents.push({
          inlineData: {
            data: fileData,
            mimeType: sources.pressRelease.file.mimeType,
          },
        });
      }

      if (sourceText.trim()) {
        contents.push(sourceText);
      }
    }

    // Call Gemini with "gemini-3.5-flash"
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
      },
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error("No response received from Gemini API");
    }

    const parsedJson = JSON.parse(responseText.trim());
    return res.json(parsedJson);
  } catch (error: any) {
    console.error("Write Commentary Error:", error);
    return res.status(500).json({ error: error.message || "Failed to write commentary highlights" });
  }
});

// Serve frontend build static files
app.use(express.static(path.join(__dirname, "dist")));

// Fallback all routes to index.html (SPA mode)
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server is running on http://0.0.0.0:${port}`);
});
