import { prisma } from "../config/prisma.js";

export const savePullRequest = async (input: {
  analysisId: string;
  findingId: string;
  fixProposalId: string;
  verificationResultId: string;
  owner: string;
  repo: string;
  branchName: string;
  baseBranch: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  title: string;
}) => {
  return prisma.pullRequest.create({
    data: {
      analysisId: input.analysisId,
      findingId: input.findingId,
      fixProposalId: input.fixProposalId,
      verificationResultId:
        input.verificationResultId,

      repositoryOwner: input.owner,
      repositoryName: input.repo,

      branchName: input.branchName,
      baseBranch: input.baseBranch,

      commitSha: input.commitSha,

      pullRequestNumber:
        input.pullRequestNumber,
      pullRequestUrl:
        input.pullRequestUrl,

      title: input.title,
      status: "OPEN",
    },
  });
};