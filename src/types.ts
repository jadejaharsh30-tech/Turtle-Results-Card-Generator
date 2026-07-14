export interface Metric {
  id: string; // unique ID for editing stability
  label: string;
  current: number | null;
  prev_q: number | null;
  prev_y: number | null;
  is_ratio: boolean;
  lower_is_better: boolean;
  decimals: number;
}

export interface TableData {
  company: string;
  period: string;
  unit: string;
  col_current: string;
  col_prev_q: string;
  col_prev_y: string;
  metrics: Metric[];
}

export interface Screenshot {
  id: number;
  mimeType: string;
  data: string; // Base64 encoding
  name: string;
}

export interface SourceDoc {
  file: { mimeType: string; data: string; name: string } | null;
  text: string;
}

export interface SourcesState {
  quarterlyResults: SourceDoc;
  investorPresentation: SourceDoc;
  pressRelease: SourceDoc;
}

export type FundType = "Growth Mantra" | "Wealth Mantra";
