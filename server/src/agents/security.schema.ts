export const SECURITY_DETECTION_JSON_SCHEMA = {
  type: "object",

  additionalProperties: false,

  properties: {
    findings: {
      type: "array",

      items: {
        type: "object",

        additionalProperties: false,

        properties: {
          title: {
            type: "string",
          },

          description: {
            type: "string",
          },

          category: {
            type: "string",

            enum: [
              "SECRET_EXPOSURE",
              "INJECTION",
              "AUTHENTICATION",
              "AUTHORIZATION",
              "CRYPTOGRAPHY",
              "INPUT_VALIDATION",
              "PATH_TRAVERSAL",
              "SSRF",
              "COMMAND_EXECUTION",
              "DATA_EXPOSURE",
              "INSECURE_CONFIGURATION",
              "DEPENDENCY",
              "OTHER",
            ],
          },

          severity: {
            type: "string",

            enum: [
              "LOW",
              "MEDIUM",
              "HIGH",
              "CRITICAL",
            ],
          },

          filePath: {
            type: "string",
          },

          lineStart: {
            type: "integer",
            minimum: 1,
          },

          lineEnd: {
            type: "integer",
            minimum: 1,
          },

          evidence: {
            type: "string",
          },

          suggestedFix: {
            type: "string",
          },

          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },

        required: [
          "title",
          "description",
          "category",
          "severity",
          "filePath",
          "lineStart",
          "lineEnd",
          "evidence",
          "suggestedFix",
          "confidence",
        ],
      },
    },
  },

  required: ["findings"],
} as const;