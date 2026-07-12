import { confirm, input, select } from "@inquirer/prompts";

export interface PromptChoice<T> {
  name: string;
  value: T;
  description?: string;
}

export interface PromptAdapter {
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
  input(message: string, defaultValue?: string): Promise<string>;
  select<T>(message: string, choices: readonly PromptChoice<T>[], defaultValue: T): Promise<T>;
}

export const terminalPromptAdapter: PromptAdapter = {
  confirm: async (message, defaultValue = false) => confirm({ message, default: defaultValue }),
  input: async (message, defaultValue = "") => input({ message, default: defaultValue }),
  select: async (message, choices, defaultValue) => select({ message, choices, default: defaultValue })
};
