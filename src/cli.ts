import {
  outputFileSync as writeFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "fs-extra";
import { globSync } from "glob";
import path from "path";

import chalk from "chalk";
import gradient from "gradient-string";

import * as api from ".";

if (!existsSync(path.join(process.cwd(), "input"))) {
  mkdirSync(path.join(process.cwd(), "input"));
}

if (!existsSync(path.join(process.cwd(), "output"))) {
  mkdirSync(path.join(process.cwd(), "output"));
}

const files = globSync(`input/**/*.js`).map((file) =>
  file.split("\\").slice(1).join("\\")
);

let currentFile = files[0];
const errors = new Map<string, string[]>();

const startTime = Math.floor(new Date().getTime() / 1000);

for (const file of files) {
  currentFile = file;

  try {
    const filePath = path.join(process.cwd(), "input", file);
    const data = readFileSync(filePath, "utf-8");

    writeFileSync(
      path.join(process.cwd(), "output", `${file}x`),
      api.parseFile(data)
    );

    console.log(
      `${gradient.morning(
        `[${files.indexOf(currentFile) + 1}/${files.length}]`
      )}\t${currentFile}`
    );
  } catch (e: any) {
    errors.set(currentFile, [...(errors.get(currentFile) || []), e.toString()]);

    console.log(
      `${gradient.morning(
        `[${files.indexOf(currentFile) + 1}/${files.length}]`
      )}\t${chalk.red(currentFile)}`
    );
  }
}

const finishTime = Math.floor(new Date().getTime() / 1000);

console.log();
console.log(`Completed in ${finishTime - startTime}s.`);

console.log(
  `${[...errors.values()].flat().length >= 1 ? `▾` : `▸`} Errors: [${
    [...errors.values()].flat().length
  }]`
);

for (const key of errors.keys()) {
  console.log(`    ${chalk.bold(`▾ ${key}`)}`);
  for (const error of errors.get(key)!) {
    console.log(`        ${error}`);
  }

  console.log();
}
