import { RepositoryContext } from "./context.types.js";

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

  sections.push("\nSOURCE FILES:\n");

  for (const file of context.files) {
    sections.push(
      [
        `--- FILE: ${file.path} ---`,
        `Language: ${file.language}`,
        "",
        file.content,
        `--- END FILE: ${file.path} ---`,
      ].join("\n")
    );
  }

  return sections.join("\n");
};