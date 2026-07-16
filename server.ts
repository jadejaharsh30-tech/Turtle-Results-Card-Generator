import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Increase JSON payload limits for base64 file uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Gemini SDK with User-Agent telemetry
const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// API endpoint for Step 1: Extract & build table
app.post("/api/extract-table", async (req, res) => {
  try {
    const { resultsScreenshots, sources, overrides } = req.body;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured in the environment. Please add it via Settings > Secrets.",
      });
    }

    const contents: any[] = [];

    // Add screenshots
    if (resultsScreenshots && resultsScreenshots.length > 0) {
      resultsScreenshots.forEach((shot: any, index: number) => {
        contents.push({
          text: `[Results Screenshot #${index + 1}]`
        });
        contents.push({
          inlineData: {
            data: shot.data.split(",")[1] || shot.data, // Strip data URI prefix if present
            mimeType: shot.mimeType,
          },
        });
      });
    } else {
      return res.status(400).json({ error: "Please upload at least one results screenshot." });
    }

    // Add sources
    if (sources) {
      const sourceKeys = ["quarterlyResults", "investorPresentation", "pressRelease"];
      const sourceLabels: Record<string, string> = {
        quarterlyResults: "Quarterly Results",
        investorPresentation: "Investor Presentation",
        pressRelease: "Press Release",
      };

      sourceKeys.forEach((key) => {
        const src = sources[key];
        if (!src) return;

        if (src.file && src.file.data) {
          contents.push({
            text: `Uploaded source document: ${sourceLabels[key]}`
          });
          contents.push({
            inlineData: {
              data: src.file.data.split(",")[1] || src.file.data,
              mimeType: src.file.mimeType,
            },
          });
        }

        if (src.text && src.text.trim()) {
          contents.push({
            text: `Pasted text source (${sourceLabels[key]}):\n\n${src.text}`,
          });
        }
      });
    }

    // Build instruction prompt
    let systemInstruction = `You are a precise financial data extractor for an Indian PMS firm (Turtle Wealth). 
Your task is to read one or more screenshots and documents of a company's quarterly consolidated results and extract the key financial metrics.
Multiple screenshots/documents might contain the same tables, or overlapping information, or different segments. Cross-reference them to resolve any blur, ambiguity, or missing columns.

`;

    if (overrides) {
      if (overrides.companyName) {
        systemInstruction += `Priority Company Name Override: The user has specified the company name as "${overrides.companyName}". Please use this name in your response. \n`;
      }
      if (overrides.period) {
        systemInstruction += `Priority Period Override: The user has specified the period of results as "${overrides.period}". Please use this period name in your response. \n`;
      }
    }

    systemInstruction += `
Guidelines for metric extraction:
1. Extract consolidated headline financial metrics reported in the documents. 
2. Metrics typically include: Revenue from Operations (or Net Interest Income (NII) for banks), Operating Profit / EBITDA, Profit Before Tax (PBT), Net Profit / Profit After Tax (PAT), Margins (Operating/EBITDA Margin %, Net Margin %), and for banks, Gross NPA % and Net NPA %.
3. All values should be plain numbers. Strip commas, currency symbols, and percent signs.
4. For ratios and percentage metrics (e.g. NPA ratios, margins), set "is_ratio" to true, and set "decimals" to 2.
5. If a metric is a ratio where a lower value is better (like Gross NPA %, Net NPA %, Cost-to-Income %, Debt-to-Equity), set "lower_is_better" to true. For general revenue, profit, margins, set "lower_is_better" to false.
6. For non-percentage rupee metrics, set "is_ratio" to false, and set "decimals" to 0.
7. If a value is not available in a column (e.g., previous quarter was not reported), use null.
8. NEVER invent or hallucinate figures. If a metric is missing, use null or omit it.

Respond strictly in JSON matching the specified schema. No markdown fences, no wrapping, just raw JSON.`;

    contents.push({
      text: "Please extract the reported financial metrics now and output the JSON."
    });

    // Make Gemini API call
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            company: {
              type: Type.STRING,
              description: "The name of the company. Prioritize the user override if provided.",
            },
            period: {
              type: Type.STRING,
              description: "The period of the earnings (e.g. Q1 FY27). Prioritize the user override if provided.",
            },
            unit: {
              type: Type.STRING,
              description: "Unit of the values, typically '₹ CR.' or '₹ Lakhs' or '₹ Lakh' as reported.",
            },
            col_current: {
              type: Type.STRING,
              description: "Header for the current quarter (e.g. Q1 FY27).",
            },
            col_prev_q: {
              type: Type.STRING,
              description: "Header for the previous quarter (e.g. Q4 FY26). Use null if not available.",
            },
            col_prev_y: {
              type: Type.STRING,
              description: "Header for the same quarter in the previous year (e.g. Q1 FY26). Use null if not available.",
            },
            metrics: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: {
                    type: Type.STRING,
                    description: "Standard descriptive label of the metric.",
                  },
                  current: {
                    type: Type.NUMBER,
                    description: "Value for the current quarter or null if not reported.",
                  },
                  prev_q: {
                    type: Type.NUMBER,
                    description: "Value for the previous quarter or null if not reported.",
                  },
                  prev_y: {
                    type: Type.NUMBER,
                    description: "Value for the previous year's same quarter or null.",
                  },
                  is_ratio: {
                    type: Type.BOOLEAN,
                    description: "True if the value is a percentage, ratio or margin (like NPA %, EBITDA % or Cost/Income %)."
                  },
                  lower_is_better: {
                    type: Type.BOOLEAN,
                    description: "True if a lower value is favorable (e.g. NPAs, Cost/Income), False if higher is favorable (e.g. Profit, Revenue, Margins)."
                  },
                  decimals: {
                    type: Type.INTEGER,
                    description: "Decimals to format: usually 0 for large currency numbers, 2 for ratios."
                  }
                },
                required: ["label", "is_ratio", "lower_is_better", "decimals"],
              },
            },
          },
          required: ["company", "period", "unit", "col_current", "metrics"],
        },
      },
    });

    const textResponse = response.text;
    if (!textResponse) {
      throw new Error("No response content from Gemini.");
    }

    const parsedJson = JSON.parse(textResponse.trim());
    res.json(parsedJson);

  } catch (err: any) {
    console.error("Step 1 Extraction Error:", err);
    res.status(500).json({
      error: `Extraction failed: ${err.message || err}. Try using clearer screenshots, or verify your source uploads.`,
    });
  }
});

// API endpoint for Step 2: Write highlights/commentary
app.post("/api/write-commentary", async (req, res) => {
  try {
    const { tableData, resultsScreenshots, sources, fund, scoreText } = req.body;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured in the environment.",
      });
    }

    const contents: any[] = [];

    // Add authoritative user-confirmed table data
    contents.push({
      text: `Authoritative Confirmed Financial Numbers (Use this as the absolute source of truth for figures, do not let anything override these numbers):
${JSON.stringify(tableData, null, 2)}`
    });

    // Add screenshots for context/cross-referencing
    if (resultsScreenshots && resultsScreenshots.length > 0) {
      resultsScreenshots.forEach((shot: any, index: number) => {
        contents.push({
          inlineData: {
            data: shot.data.split(",")[1] || shot.data,
            mimeType: shot.mimeType,
          },
        });
      });
    }

    // Add source documents for context/enrichment (particularly dividend checks)
    if (sources) {
      const sourceKeys = ["quarterlyResults", "investorPresentation", "pressRelease"];
      const sourceLabels: Record<string, string> = {
        quarterlyResults: "Quarterly Results",
        investorPresentation: "Investor Presentation",
        pressRelease: "Press Release",
      };

      sourceKeys.forEach((key) => {
        const src = sources[key];
        if (!src) return;

        if (src.file && src.file.data) {
          contents.push({
            text: `Uploaded source document: ${sourceLabels[key]}`
          });
          contents.push({
            inlineData: {
              data: src.file.data.split(",")[1] || src.file.data,
              mimeType: src.file.mimeType,
            },
          });
        }

        if (src.text && src.text.trim()) {
          contents.push({
            text: `Pasted text source (${sourceLabels[key]}):\n\n${src.text}`,
          });
        }
      });
    }

    const systemInstruction = `You are an equity analyst at an Indian PMS firm (Turtle Wealth) writing "Key Business Highlights" for a client-facing result commentary.
You must respond ONLY with raw JSON matching the required schema.

Write 4–5 highlights based on the confirmed numbers in the table and the provided source documents.
Guidelines for the points:
1. Ground every point in the confirmed table numbers and the provided source documents. Never invent or hallucinate figures.
2. Tone: Plain, confident, investor-friendly English. Use Indian numbering formats where appropriate (e.g., ₹ crore or ₹ lakh crore, and percentage moves like %).
3. Depth: Each point MUST be concise and strictly limited to a maximum of 2–3 lines (around 20–30 words) when formatted. Keep them crisp and direct, presenting key facts and figures without fluff.
4. Content: Cover the most material items: growth in business/revenue/NII, profitability/margins, asset quality/NPAs, segment drivers, and notable operational strength.
5. DIVIDEND REQUIREMENT: Scan every provided source document and pasted text for any DIVIDEND declared, recommended, or paid this quarter. 
   If a dividend exists, you MUST include a dedicated highlight point stating the amount per share, percentage (if given), and the record/payment date if provided.

The response must be raw JSON matching the schema. No markdown fences.`;

    contents.push({
      text: `Generate 4 to 5 key highlights. Fund name is "${fund}". Turtle Score statement is: "${scoreText}".`
    });

    // Make Gemini API call
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            highlights: {
              type: Type.ARRAY,
              items: {
                type: Type.STRING,
                description: "A concise key business highlight point (strictly max 2-3 lines long) grounded in the source.",
              },
            },
          },
          required: ["highlights"],
        },
      },
    });

    const textResponse = response.text;
    if (!textResponse) {
      throw new Error("No response content from Gemini.");
    }

    const parsedJson = JSON.parse(textResponse.trim());
    res.json(parsedJson);

  } catch (err: any) {
    console.error("Step 2 Commentary Error:", err);
    res.status(500).json({
      error: `Failed to generate commentary: ${err.message || err}. Please try again.`,
    });
  }
});

// Setup Vite Dev Server or Production Static Asset Server
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Development mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development middleware mounted.");
  } else {
    // Production mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Production static files server mounted.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
