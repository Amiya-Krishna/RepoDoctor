import { calculateRisk } from "./risk.calculator.js";

import type {
  RepositoryRiskSummary,
  RiskInput,
  RiskAssessment,
} from "./risk.types.js";

export interface RiskFinding
  extends RiskInput {
  id: string;
}

export interface EvaluatedFinding
  extends RiskFinding {
  risk: RiskAssessment;
}

export const evaluateFindings = (
  findings: RiskFinding[]
): EvaluatedFinding[] => {
  return findings.map((finding) => ({
    ...finding,
    risk: calculateRisk(finding),
  }));
};

export const calculateRepositoryRisk = (
  findings: EvaluatedFinding[]
): RepositoryRiskSummary => {
  if (findings.length === 0) {
    return {
      overallScore: 0,
      level: "LOW",
      priority: "P3",
      totalFindings: 0,
      criticalFindings: 0,
      highFindings: 0,
      mediumFindings: 0,
      lowFindings: 0,
    };
  }

  const sorted = [...findings].sort(
    (a, b) =>
      b.risk.score - a.risk.score
  );

  const topFindings = sorted.slice(0, 5);

  const overallScore = Math.min(
    Math.round(
      topFindings.reduce(
        (sum, finding) =>
          sum + finding.risk.score,
        0
      ) / topFindings.length
    ),
    100
  );

  const criticalFindings =
    findings.filter(
      (finding) =>
        finding.risk.level === "CRITICAL"
    ).length;

  const highFindings =
    findings.filter(
      (finding) =>
        finding.risk.level === "HIGH"
    ).length;

  const mediumFindings =
    findings.filter(
      (finding) =>
        finding.risk.level === "MEDIUM"
    ).length;

  const lowFindings =
    findings.filter(
      (finding) =>
        finding.risk.level === "LOW"
    ).length;

  const highestRisk = sorted[0];

  return {
    overallScore,

    level: highestRisk.risk.level,

    priority: highestRisk.risk.priority,

    totalFindings: findings.length,

    criticalFindings,

    highFindings,

    mediumFindings,

    lowFindings,
  };
};