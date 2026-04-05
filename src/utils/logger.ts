import { Chalk } from 'chalk';

const chalk = new Chalk({ level: 3 });

const colors = {
  info: chalk.blue,
  success: chalk.green,
  warn: chalk.hex('#FFA500'),
  error: chalk.red,
  text: chalk.white,
  dim: chalk.gray,
};

export class Logger {
  static info(message: string): void {
    console.log(colors.info('=>'), colors.text(message));
  }

  static success(message: string): void {
    console.log(colors.success('[0k]'), colors.text(message));
  }

  static warn(message: string): void {
    console.log(colors.warn('[warn]'), colors.warn(message));
  }

  static error(message: string): void {
    console.error(colors.error('[error]'), colors.error(message));
  }

  static step(step: number, description: string): void {
    console.log(colors.info(`[${step}/8]`), chalk.bold.white(description));
  }

  static raw(line: string): void {
    console.log(colors.dim(line));
  }

  static newline(): void {
    console.log();
  }
}

export function log(message: string): void {
  Logger.info(message);
}
