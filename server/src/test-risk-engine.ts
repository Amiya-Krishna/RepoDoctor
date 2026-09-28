import {
  calculateRepositoryRisk,
  evaluateFindings,
} from "./risk/risk.engine.js";

const findings = [
  {
    id: "bug-1",
    source: "BUG" as const,
    severity: "HIGH",
    confidence: 0.9,
    category: "LOGIC",
    filePath: "src/payment.ts",
  },

  {
    id: "security-1",
    source: "SECURITY" as const,
    severity: "CRITICAL",
    confidence: 0.96,
    category: "INJECTION",
    filePath: "src/api.ts",
  },

  {
    id: "security-2",
    source: "SECURITY" as const,
    severity: "MEDIUM",
    confidence: 0.65,
    category: "INSECURE_CONFIGURATION",
    filePath: "src/config.ts",
  },
];

const evaluated =
  evaluateFindings(findings);

console.log(
  "\n=============================="
);

console.log(
  "RISK ENGINE RESULTS"
);

console.log(
  "==============================\n"
);

for (const finding of evaluated) {
  console.log(`Finding: ${finding.id}`);
  console.log(
    `Source: ${finding.source}`
  );
  console.log(
    `Severity: ${finding.severity}`
  );
  console.log(
    `Category: ${finding.category}`
  );
  console.log(
    `Confidence: ${finding.confidence}`
  );
  console.log(
    `Risk Score: ${finding.risk.score}`
  );
  console.log(
    `Risk Level: ${finding.risk.level}`
  );
  console.log(
    `Priority: ${finding.risk.priority}`
  );

  console.log(
    "------------------------------"
  );
}

const summary =
  calculateRepositoryRisk(evaluated);

console.log("\nRepository Risk");
console.log("==============================");

console.log(
  `Overall Score: ${summary.overallScore}`
);

console.log(
  `Level: ${summary.level}`
);

console.log(
  `Priority: ${summary.priority}`
);

console.log(
  `Total Findings: ${summary.totalFindings}`
);

console.log(
  `Critical: ${summary.criticalFindings}`
);

console.log(
  `High: ${summary.highFindings}`
);

console.log(
  `Medium: ${summary.mediumFindings}`
);

console.log(
  `Low: ${summary.lowFindings}`
);