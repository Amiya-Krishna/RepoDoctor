import {
  BUG_CATEGORY_BONUS,
  CONFIDENCE_WEIGHT,
  MAX_RISK_SCORE,
  SECURITY_CATEGORY_BONUS,
  SEVERITY_SCORES,
} from "./risk.rules.js";

import type {
  RiskAssessment,
  RiskInput,
} from "./risk.types.js";

export const calculateRisk = (
  finding: RiskInput
): RiskAssessment => {
  const severityScore =
    SEVERITY_SCORES[
      finding.severity.toUpperCase()
    ] ?? 20;

  const categoryBonus =
    finding.source === "SECURITY"
      ? SECURITY_CATEGORY_BONUS[
          finding.category.toUpperCase()
        ] ?? 0
      : BUG_CATEGORY_BONUS[
          finding.category.toUpperCase()
        ] ?? 0;

  const confidenceFactor =
    CONFIDENCE_WEIGHT +
    finding.confidence *
    (1 - CONFIDENCE_WEIGHT);

  let score =
    (severityScore + categoryBonus) *
    confidenceFactor;

  score = Math.min(
    Math.round(score),
    MAX_RISK_SCORE
  );

  const level = getRiskLevel(score);

  const priority = getPriority(level);

  const factors: string[] = [
    `Severity: ${finding.severity}`,
    `Confidence: ${finding.confidence}`,
    `Category: ${finding.category}`,
  ];

  if (categoryBonus > 0) {
    factors.push(
      `Category bonus: +${categoryBonus}`
    );
  }

  return {
    score,
    level,
    priority,
    factors,
  };
};

const getRiskLevel = (
  score: number
): RiskAssessment["level"] => {
  if (score >= 85) {
    return "CRITICAL";
  }

  if (score >= 65) {
    return "HIGH";
  }

  if (score >= 35) {
    return "MEDIUM";
  }

  return "LOW";
};

const getPriority = (
  level: RiskAssessment["level"]
): RiskAssessment["priority"] => {
  switch (level) {
    case "CRITICAL":
      return "P0";

    case "HIGH":
      return "P1";

    case "MEDIUM":
      return "P2";

    case "LOW":
    default:
      return "P3";
  }
};