import type { RepositoryContext } from "../context/context.types.js";
import type { SecurityCategory, SecurityFinding, SecuritySeverity } from "../agents/security.types.js";

interface Rule {
  category: SecurityCategory;
  severity: SecuritySeverity;
  title: string;
  description: string;
  pattern: RegExp;
  suggestedFix: string;
  confidence: number;
}

const rules: Rule[] = [
  {
    category: "SECRET_EXPOSURE",
    severity: "HIGH",
    title: "Possible hardcoded secret",
    description: "A credential-like variable appears to be assigned a literal string. Verify that this is not a real secret.",
    pattern: /\b(?:api[_-]?key|secret|access[_-]?token|password|private[_-]?key)\b\s*[:=]\s*["'`][^"'`\n]{8,}["'`]/i,
    suggestedFix: "Load secrets from a secret manager or environment variable and rotate any exposed credential.",
    confidence: 0.78,
  },
  {
    category: "COMMAND_EXECUTION",
    severity: "HIGH",
    title: "Potentially unsafe dynamic command execution",
    description: "A command-execution API appears to use dynamically constructed input.",
    pattern: /\b(?:exec|execSync)\s*\([^;\n]*(?:\+|`|\$\{)/,
    suggestedFix: "Prefer execFile with a fixed executable and validated argument array; avoid shell interpolation.",
    confidence: 0.74,
  },
  {
    category: "INJECTION",
    severity: "HIGH",
    title: "Potentially unsafe dynamic code evaluation",
    description: "Dynamic evaluation can execute attacker-controlled JavaScript when input is not trusted.",
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
    suggestedFix: "Remove dynamic evaluation and use explicit parsing or a safe dispatch table.",
    confidence: 0.82,
  },
  {
    category: "INJECTION",
    severity: "HIGH",
    title: "Potential SQL injection pattern",
    description: "A query-like call appears to build SQL using interpolation or concatenation.",
    pattern: /\b(?:query|execute)\s*\(\s*(`[^`]*(?:\$\{|SELECT|INSERT|UPDATE|DELETE)|["'][^"']*(?:SELECT|INSERT|UPDATE|DELETE)[^"']*["']\s*\+)/i,
    suggestedFix: "Use parameterized queries or the ORM's parameter-binding API.",
    confidence: 0.7,
  },
  {
    category: "PATH_TRAVERSAL",
    severity: "MEDIUM",
    title: "Potential user-controlled filesystem path",
    description: "A filesystem API appears to receive request-derived input without visible path containment checks.",
    pattern: /\b(?:readFile|readFileSync|writeFile|writeFileSync|sendFile)\s*\([^;\n]*(?:req\.(?:params|query|body)|request\.(?:params|query|body))/,
    suggestedFix: "Resolve the path against an allowed root and reject paths that escape that root.",
    confidence: 0.65,
  },
  {
    category: "INSECURE_CONFIGURATION",
    severity: "MEDIUM",
    title: "Wildcard CORS origin",
    description: "A wildcard CORS origin may expose browser-accessible APIs more broadly than intended.",
    pattern: /\bcors\s*\(\s*\{\s*[^}]*\borigin\s*:\s*["']\*["']/i,
    suggestedFix: "Restrict CORS to the exact trusted frontend origins.",
    confidence: 0.72,
  },
];

const redactEvidence = (line: string, category: SecurityCategory): string => {
  if (category === "SECRET_EXPOSURE") return "Credential-like literal detected; value intentionally redacted.";
  return line.trim().slice(0, 240);
};

export function scanStaticSecurity(context: RepositoryContext): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const file of context.files) {
    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      for (const rule of rules) {
        if (!rule.pattern.test(line)) continue;

        // Avoid reporting obvious environment lookups and placeholder examples as secrets.
        if (
          rule.category === "SECRET_EXPOSURE" &&
          (/\bprocess\.env\b|\bimport\.meta\.env\b|example|placeholder|your[_ -]/i.test(line))
        ) {
          continue;
        }

        findings.push({
          title: rule.title,
          description: rule.description,
          category: rule.category,
          severity: rule.severity,
          filePath: file.path,
          lineStart: index + 1,
          lineEnd: index + 1,
          evidence: redactEvidence(line, rule.category),
          suggestedFix: rule.suggestedFix,
          confidence: rule.confidence,
        });
      }
    }
  }

  const unique = new Map<string, SecurityFinding>();
  for (const finding of findings) {
    const key = `${finding.filePath}:${finding.lineStart}:${finding.category}`;
    if (!unique.has(key)) unique.set(key, finding);
  }
  return [...unique.values()];
}
