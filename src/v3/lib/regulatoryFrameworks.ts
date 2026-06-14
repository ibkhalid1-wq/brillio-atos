export const REGULATORY_FRAMEWORKS: Record<string, {
  name: string;
  articles: Array<{ id: string; title: string; keywords: string[] }>;
}> = {
  GDPR: {
    name: "General Data Protection Regulation",
    articles: [
      { id: "Art.5", title: "Principles of data processing", keywords: ["personal data", "processing", "consent"] },
      { id: "Art.17", title: "Right to erasure", keywords: ["deletion", "erasure", "retention"] },
      { id: "Art.25", title: "Data protection by design", keywords: ["privacy", "design", "default"] },
      { id: "Art.32", title: "Security of processing", keywords: ["encryption", "security", "breach"] },
      { id: "Art.35", title: "Data protection impact assessment", keywords: ["DPIA", "high risk", "assessment"] },
    ],
  },
  SOX: {
    name: "Sarbanes-Oxley",
    articles: [
      { id: "302", title: "Corporate responsibility for financial reports", keywords: ["financial controls", "attestation", "reporting"] },
      { id: "404", title: "Management assessment of internal controls", keywords: ["internal control", "audit", "segregation of duties"] },
    ],
  },
  HIPAA: {
    name: "Health Insurance Portability and Accountability Act",
    articles: [
      { id: "164.308", title: "Administrative safeguards", keywords: ["access", "training", "workforce"] },
      { id: "164.312", title: "Technical safeguards", keywords: ["encryption", "audit log", "authentication"] },
    ],
  },
  FCA: {
    name: "Financial Conduct Authority",
    articles: [
      { id: "SYSC", title: "Senior management arrangements, systems and controls", keywords: ["governance", "control", "oversight"] },
      { id: "PRIN", title: "Principles for businesses", keywords: ["conduct", "customer", "fairness"] },
    ],
  },
};

export function inferFrameworksFromIndustry(industry: string | null | undefined): string[] {
  const value = (industry || "").toLowerCase();
  if (value.includes("health")) return ["HIPAA", "GDPR"];
  if (value.includes("bank") || value.includes("finance")) return ["SOX", "FCA", "GDPR"];
  if (value.includes("public") || value.includes("government")) return ["GDPR"];
  return ["GDPR"];
}
