export const TEST_GENERATION_JSON_SCHEMA = {
  type: "object",

  additionalProperties: false,

  properties: {
    tests: {
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

          type: {
            type: "string",
            enum: [
              "UNIT",
              "INTEGRATION",
              "EDGE_CASE",
              "REGRESSION",
            ],
          },

          filePath: {
            type: "string",
            description:
              "Path where the generated test would be created. This file may not currently exist."
          },

          targetFilePath: {
            type: "string",
            description:
              "Existing source file from the repository context that the generated test targets."
          },

          targetFunction: {
            type: ["string", "null"],
          },

          testCode: {
            type: "string",
          },

          rationale: {
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
          "type",
          "filePath",
          "targetFilePath",
          "targetFunction",
          "testCode",
          "rationale",
          "confidence",
        ],
      },
    },
  },

  required: ["tests"],
} as const;