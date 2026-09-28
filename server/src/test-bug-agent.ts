import { createAIProvider } from "./ai/ai.provider.factory.js";
 
import { BugDetectionAgent } from "./agents/bug-detection.agent.js"; 
 
import { 
  buildRepositoryContext, 
} from "./context/context.builder.js"; 
 
import { 
  formatRepositoryContext, 
} from "./context/context.formatter.js"; 
 
const main = async () => { 
  const workspacePath = process.argv[2]; 
 
  if (!workspacePath) { 
    throw new Error( 
      "Usage: npm run test:bug-agent -- <workspace-path>" 
    ); 
  } 
 
  console.log("Building repository context..."); 
 
  const context = 
    await buildRepositoryContext( 
      workspacePath, 
      "test-repository", 
      { 
        projectType: "Node.js", 
        language: "TypeScript", 
        framework: "Express", 
        packageManager: "npm", 
      } 
    ); 
 
  console.log( 
    `Selected files: ${context.files.length}` 
  ); 
 
  const formattedContext = 
    formatRepositoryContext(context); 
 
  console.log("Calling AI Provider Manager...");
 
  const provider = createAIProvider();
 
  const agent = 
    new BugDetectionAgent(provider); 
 
  const result = 
    await agent.detect( 
      context, 
      formattedContext 
    ); 
 
  console.log("\nBUG FINDINGS\n"); 
 
  console.dir(result, { 
    depth: null, 
  }); 
}; 
 
main().catch((error) => { 
  console.error( 
    "Bug detection failed:", 
    error 
  ); 
 
  process.exit(1); 
});