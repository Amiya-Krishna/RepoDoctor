import { prisma } from "../config/prisma.js";

import {
  buildRepositoryContext,
} from "../context/context.builder.js";

import {
  formatRepositoryContext,
} from "../context/context.formatter.js";

import { BugDetectionAgent } from "../agents/bug-detection.agent.js";
import { SecurityAgent } from "../agents/security.agent.js";
import { TestGenerationAgent } from "../agents/test-generation.agent.js";

import { createAIProvider } from "../ai/ai.provider.factory.js";

import {
  saveBugFindings,
} from "../services/bug-finding.service.js";

import {
  saveSecurityFindings,
} from "../services/security-finding.service.js";

import {
  saveGeneratedTests,
} from "../services/generated-test.service.js";

import {
  saveRiskAssessments,
} from "../services/risk-assessment.service.js";

import {
  calculateRepositoryRisk,
  evaluateFindings,
} from "../risk/risk.engine.js";

import {
  AnalysisPipelineError,
} from "./analysis.pipeline.errors.js";

import type {
  AnalysisPipelineInput,
  AnalysisPipelineResult,
} from "./analysis.pipeline.types.js";

export const runAnalysisPipeline = async (
  input: AnalysisPipelineInput
): Promise<AnalysisPipelineResult> => {
  const {
    analysisId,
    repositoryPath,
  } = input;

  try {
    await markAnalysisRunning(analysisId);

    // ========================================
    // STAGE 1: BUILD CONTEXT
    // ========================================

    const context =
      await buildRepositoryContext(
        repositoryPath,
        analysisId
      );

    const formattedContext =
      formatRepositoryContext(context);

    // ========================================
    // STAGE 2: CREATE AI PROVIDER
    // ========================================

    const aiProvider =
      createAIProvider();

    // ========================================
    // STAGE 3: BUG DETECTION
    // ========================================

    const bugAgent =
      new BugDetectionAgent(aiProvider);

    let bugResult;

    try {
      bugResult =
        await bugAgent.detect(
          context,
          formattedContext
        );
    } catch (error) {
      throw new AnalysisPipelineError(
        "Bug detection failed.",
        "BUG_DETECTION",
        error
      );
    }

    const savedBugFindings =
      await saveBugFindings(
        analysisId,
        bugResult
      );

    // ========================================
    // STAGE 4: SECURITY ANALYSIS
    // ========================================

    const securityAgent =
      new SecurityAgent(aiProvider);

    let securityResult;

    try {
      securityResult =
        await securityAgent.detect(
          context,
          formattedContext
        );
    } catch (error) {
      throw new AnalysisPipelineError(
        "Security analysis failed.",
        "SECURITY_ANALYSIS",
        error
      );
    }

    const savedSecurityFindings =
      await saveSecurityFindings(
        analysisId,
        securityResult
      );

    // ========================================
    // STAGE 5: TEST GENERATION
    // ========================================

    const testAgent =
      new TestGenerationAgent(aiProvider);

    let testResult;

    try {
      testResult =
        await testAgent.generate(
          context,
          formattedContext
        );
    } catch (error) {
      throw new AnalysisPipelineError(
        "Test generation failed.",
        "TEST_GENERATION",
        error
      );
    }
    // ========================================
    // STAGE 6: BUILD RISK INPUT
    // ========================================

    const riskInputs = [
      ...savedBugFindings.map(
        (finding) => ({
          id: finding.id,
          source: "BUG" as const,
          severity: finding.severity,
          confidence: finding.confidence,
          category: finding.category,
          filePath: finding.filePath,
        })
      ),

      ...savedSecurityFindings.map(
        (finding) => ({
          id: finding.id,
          source: "SECURITY" as const,
          severity: finding.severity,
          confidence: finding.confidence,
          category: finding.category,
          filePath: finding.filePath,
        })
      ),
    ];

    // ========================================
    // STAGE 7: RISK ENGINE
    // ========================================

    const evaluatedFindings =
      evaluateFindings(riskInputs);

    const riskSummary =
      calculateRepositoryRisk(
        evaluatedFindings
      );

    // ========================================
    // STAGE 8: SAVE RISK ASSESSMENTS
    // ========================================

    await saveRiskAssessments(
      analysisId,
      evaluatedFindings
    );

    // ========================================
    // STAGE 9: COMPLETE ANALYSIS
    // ========================================

    await markAnalysisCompleted(
      analysisId,
      context
    );

    return {
      analysisId,

      bugResult,

      securityResult,

      testResult,

      evaluatedFindings,

      riskSummary,
    };
  } catch (error) {
    await markAnalysisFailed(
      analysisId,
      error
    );

    if (
      error instanceof AnalysisPipelineError
    ) {
      throw error;
    }

    throw new AnalysisPipelineError(
      "Analysis pipeline failed.",
      "UNKNOWN",
      error
    );
  }
};

const markAnalysisRunning = async (
  analysisId: string
): Promise<void> => {
  await prisma.analysis.update({
    where: {
      id: analysisId,
    },

    data: {
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
};

const markAnalysisCompleted = async (
  analysisId: string,
  context: {
    projectType?: string;
    language?: string;
    packageManager?: string;
    framework?: string;
  }
): Promise<void> => {
  await prisma.analysis.update({
    where: {
      id: analysisId,
    },

    data: {
      status: "COMPLETED",

      completedAt: new Date(),

      projectType:
        context.projectType ?? null,

      language:
        context.language ?? null,

      packageManager:
        context.packageManager ?? null,

      framework:
        context.framework ?? null,
    },
  });
};

const markAnalysisFailed = async (
  analysisId: string,
  error: unknown
): Promise<void> => {
  console.error(
    "Analysis pipeline failed:",
    error
  );

  try {
    await prisma.analysis.update({
      where: {
        id: analysisId,
      },

      data: {
        status: "FAILED",

        completedAt: new Date(),
      },
    });
  } catch (updateError) {
    console.error(
      "Failed to update analysis status:",
      updateError
    );
  }
};