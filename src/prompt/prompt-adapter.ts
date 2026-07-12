import { confirm } from "@inquirer/prompts";

export interface PromptAdapter {
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
}

export const terminalPromptAdapter: PromptAdapter = {
  confirm: async (message, defaultValue = false) => confirm({ message, default: defaultValue })
};
