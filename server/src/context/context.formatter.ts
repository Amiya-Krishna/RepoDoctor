import type { RepositoryContext } from "./context.types.js";
import { wrapUntrustedContext } from "../security/untrusted-context.js";
import { isSensitiveFilePath } from "../security/secret-redactor.js";

export const formatRepositoryContext = (
  context: RepositoryContext
) => {
  const sections: string[] = [];

  sections.push(
    `Repository ID: ${context.repositoryId}`
  );

  if (context.projectType) {
    sections.push(
      `Project Type: ${context.projectType}`
    );
  }

  if (context.language) {
    sections.push(
      `Language: ${context.language}`
    );
  }

  if (context.framework) {
    sections.push(
      `Framework: ${context.framework}`
    );
  }

  if (context.packageManager) {
    sections.push(
      `Package Manager: ${context.packageManager}`
    );
  }

  sections.push("\nALLOWED TARGET FILE PATHS:\n");

  for (const file of context.files) {
    sections.push(file.path);
  }

  sections.push("\nSOURCE FILE CONTENT:\n");

  // Repository content is attacker-controllable. It goes inside a nonce-delimited
  // block that tells the model it is data, and sensitive files are never included.
  const blocks: string[] = [];
  for (const file of context.files) {
    if (isSensitiveFilePath(file.path)) continue;
    blocks.push(
      [
        `--- FILE: ${file.path} ---`,
        `Language: ${file.language}`,
        "",
        file.content,
        `--- END FILE: ${file.path} ---`,
      ].join("\n")
    );
  }
  sections.push(wrapUntrustedContext("repository source files", blocks.join("\n")));

  return sections.join("\n");
};