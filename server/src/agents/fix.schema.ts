export const FIX_RESULT_JSON_SCHEMA = {
  type: "object",

  additionalProperties: false,

  properties: {
    title: {
      type: "string",
    },

    summary: {
      type: "string",
    },

    changes: {
      type: "array",

      items: {
        type: "object",

        additionalProperties: false,

        properties: {
          filePath: {
            type: "string",
          },

          changeType: {
            type: "string",

            enum: [
              "REPLACE",
              "INSERT",
              "DELETE",
            ],
          },

          startLine: {
            type: "integer",

            minimum: 1,
          },

          endLine: {
            type: "integer",

            minimum: 1,
          },

          originalCode: {
            type: "string",
          },

          replacementCode: {
            type: "string",
          },

          explanation: {
            type: "string",
          },
        },

        required: [
          "filePath",
          "changeType",
          "startLine",
          "endLine",
          "originalCode",
          "replacementCode",
          "explanation",
        ],
      },
    },

    risk: {
      type: "string",

      enum: [
        "LOW",
        "MEDIUM",
        "HIGH",
      ],
    },

    confidence: {
      type: "number",

      minimum: 0,

      maximum: 1,
    },

    reasoning: {
      type: "string",
    },
  },

  required: [
    "title",
    "summary",
    "changes",
    "risk",
    "confidence",
    "reasoning",
  ],
} as const;