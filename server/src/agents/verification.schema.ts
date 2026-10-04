export const VERIFICATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: [
        "VERIFIED",
        "FAILED",
        "INCONCLUSIVE",
        "ERROR",
      ],
    },

    title: {
      type: "string",
    },

    summary: {
      type: "string",
    },

    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },

    evidence: {
      type: "array",
      items: {
        type: "string",
      },
    },

    reasoning: {
      type: "string",
    },

    testPassed: {
      type: "boolean",
    },

    regressionDetected: {
      type: "boolean",
    },
  },

  required: [
    "status",
    "title",
    "summary",
    "confidence",
    "evidence",
    "reasoning",
    "testPassed",
    "regressionDetected",
  ],
} as const;