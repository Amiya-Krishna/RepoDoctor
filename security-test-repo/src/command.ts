import { exec } from "child_process";

export const runCommand = (
  userInput: string
) => {
  exec(`echo ${userInput}`);
};