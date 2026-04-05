#!/usr/bin/env node

import { Command } from 'commander';
import deploy from '../src/cli/deploy';
import init from '../src/cli/init';
import logs from '../src/cli/logs';
import rollback from '../src/cli/rollback';
import doctor from '../src/cli/doctor';
import { Logger } from '../src/utils/logger';

const program = new Command();

// Configure program metadata
program.name('orca').description('Deploy apps to your VPS with Docker').version('0.1.0');

// TODO: Add documentation for the init command

program
  .command('init')
  .description('Initialize a new Orca project')
  .option('--force', 'Overwrite existing orca.yml')
  .action(async (options) => {
    await init(options);
  });

program
  .command('deploy')
  .description('Deploy the application')
  .option('-c, --config <path>', 'Path to orca.yml config file')
  .action(async (options) => {
    await deploy(options.config);
  });

program
  .command('logs')
  .description('View application logs')
  .option('-n, --tail <number>', 'Number of lines to show', '100')
  .action(async (options) => {
    await logs({ tail: parseInt(options.tail, 10) });
  });

program
  .command('rollback')
  .description('Rollback to the previous deployment')
  .action(async () => {
    await rollback();
  });

program
  .command('doctor')
  .description('Run preflight checks for VPS and configuration')
  .option('-c, --config <path>', 'Path to orca.yml config file')
  .action(async (options) => {
    await doctor(options.config);
  });

process.on('unhandledRejection', (reason) => {
  Logger.error(`Unexpected error: ${reason}`);
  process.exit(1);
});

// Parse command line arguments
program.parse();
