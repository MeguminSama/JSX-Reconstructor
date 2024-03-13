import {
  Program,
  CallExpression,
  VariableDeclaration,
  VariableDeclarator,
  ImportDeclaration,
  FunctionDeclaration,
  Identifier,
} from "estree";
import { pushWithoutDuplicates } from "./utils";

class ImportParser {
  program: Program;

  imports: ImportDeclaration[];
  importIdentifiers: { original: Identifier; new: Identifier }[];

  constructor(program: Program) {
    this.program = program;

    this.imports = [];
    this.importIdentifiers = [];
  }

  isImport(node: VariableDeclarator): boolean {
    return !!(
      node.type === "VariableDeclarator" &&
      node.init &&
      node.init.type === "CallExpression" &&
      node.init.callee &&
      node.init.callee.type === "Identifier" &&
      (node.init.callee.name === "require" ||
        node.init.arguments.find(
          (argument) =>
            argument &&
            argument.type === "CallExpression" &&
            argument.callee &&
            argument.callee.type === "Identifier" &&
            argument.callee.name === "require"
        ))
    );
  }

  findInteropRequireDefault(): FunctionDeclaration | null | undefined {
    return this.program.body.find(
      (node) =>
        node.type === "FunctionDeclaration" &&
        node.body.body[0] &&
        node.body.body[0].type === "ReturnStatement" &&
        node.body.body[0].argument &&
        node.body.body[0].argument.type === "ConditionalExpression"
    )! as FunctionDeclaration;
  }

  findInteropRequireWildcard(): FunctionDeclaration | null | undefined {
    return this.program.body.find(
      (node) =>
        node.type === "FunctionDeclaration" &&
        node.body.body[0] &&
        node.body.body[0].type === "IfStatement" &&
        node.body.body[0].test &&
        node.body.body[0].test.type === "LogicalExpression"
    )! as FunctionDeclaration;
  }

  parse(
    node: VariableDeclarator,
    parent: VariableDeclaration
  ): ImportDeclaration[] {
    const exceptions = ["_invariant", "_lodash", "_moment", "superagent"];
    const replacements = ["invariant", "_", "moment", "superagent"];

    if (
      node.id &&
      node.id.type === "Identifier" &&
      node.init &&
      node.init.type === "CallExpression" &&
      node.init.callee &&
      node.init.callee.type === "Identifier"
    ) {
      var proxiedRequire = node.init.arguments[
        node.init.arguments.findIndex(
          (argument) =>
            argument &&
            argument.type === "CallExpression" &&
            argument.callee &&
            argument.callee.type === "Identifier" &&
            argument.callee.name === "require" &&
            argument.arguments[0] &&
            argument.arguments[0].type === "Literal"
        )
      ]! as CallExpression;

      if (node.init.callee.name === "require") {
        pushWithoutDuplicates(this.imports, {
          type: "ImportDeclaration",
          source: node.init.arguments[0] as any,
          specifiers: [
            {
              type: "ImportNamespaceSpecifier",
              local: {
                ...node.id,
                name: exceptions.includes(node.id.name)
                  ? replacements[exceptions.indexOf(node.id.name)]
                  : (node.id.name.length > 1 && node.id.name.startsWith("_")
                      ? node.id.name.substring(1)
                      : node.id.name
                    )
                      .charAt(0)
                      .toUpperCase() +
                    (node.id.name.length > 1 && node.id.name.startsWith("_")
                      ? node.id.name.substring(1)
                      : node.id.name
                    ).slice(1),
              },
            },
          ],
        });
        this.importIdentifiers.push({
          original: node.id,
          new: {
            ...node.id,
            name: exceptions.includes(node.id.name)
              ? replacements[exceptions.indexOf(node.id.name)]
              : (node.id.name.length > 1 && node.id.name.startsWith("_")
                  ? node.id.name.substring(1)
                  : node.id.name
                )
                  .charAt(0)
                  .toUpperCase() +
                (node.id.name.length > 1 && node.id.name.startsWith("_")
                  ? node.id.name.substring(1)
                  : node.id.name
                ).slice(1),
          },
        });
      } else if (
        proxiedRequire &&
        proxiedRequire.callee.type === "Identifier" &&
        this.findInteropRequireWildcard() &&
        node.init.callee.name === this.findInteropRequireWildcard()!.id!.name
      ) {
        pushWithoutDuplicates(this.imports, {
          type: "ImportDeclaration",
          source: proxiedRequire.arguments[0] as any,
          specifiers: [
            {
              type: "ImportNamespaceSpecifier",
              local: {
                ...node.id,
                name: exceptions.includes(node.id.name)
                  ? replacements[exceptions.indexOf(node.id.name)]
                  : (node.id.name.length > 1 && node.id.name.startsWith("_")
                      ? node.id.name.substring(1)
                      : node.id.name
                    )
                      .charAt(0)
                      .toUpperCase() +
                    (node.id.name.length > 1 && node.id.name.startsWith("_")
                      ? node.id.name.substring(1)
                      : node.id.name
                    ).slice(1),
              },
            },
          ],
        });
        this.importIdentifiers.push({
          original: node.id,
          new: {
            ...node.id,
            name: exceptions.includes(node.id.name)
              ? replacements[exceptions.indexOf(node.id.name)]
              : (node.id.name.length > 1 && node.id.name.startsWith("_")
                  ? node.id.name.substring(1)
                  : node.id.name
                )
                  .charAt(0)
                  .toUpperCase() +
                (node.id.name.length > 1 && node.id.name.startsWith("_")
                  ? node.id.name.substring(1)
                  : node.id.name
                ).slice(1),
          },
        });
      } else if (
        proxiedRequire &&
        proxiedRequire.callee.type === "Identifier" &&
        this.findInteropRequireDefault() &&
        node.init.callee.name === this.findInteropRequireDefault()!.id!.name
      ) {
        pushWithoutDuplicates(this.imports, {
          type: "ImportDeclaration",
          source: proxiedRequire.arguments[0] as any,
          specifiers: [
            {
              type: "ImportDefaultSpecifier",
              local: {
                ...node.id,
                name: exceptions.includes(node.id.name)
                  ? replacements[exceptions.indexOf(node.id.name)]
                  : (node.id.name.length > 1 && node.id.name.startsWith("_")
                      ? node.id.name.substring(1)
                      : node.id.name
                    )
                      .charAt(0)
                      .toUpperCase() +
                    (node.id.name.length > 1 && node.id.name.startsWith("_")
                      ? node.id.name.substring(1)
                      : node.id.name
                    ).slice(1),
              },
            },
          ],
        });
        this.importIdentifiers.push({
          original: node.id,
          new: {
            ...node.id,
            name: exceptions.includes(node.id.name)
              ? replacements[exceptions.indexOf(node.id.name)]
              : (node.id.name.length > 1 && node.id.name.startsWith("_")
                  ? node.id.name.substring(1)
                  : node.id.name
                )
                  .charAt(0)
                  .toUpperCase() +
                (node.id.name.length > 1 && node.id.name.startsWith("_")
                  ? node.id.name.substring(1)
                  : node.id.name
                ).slice(1),
          },
        });
      }

      if (parent.declarations.length > 1) {
        delete parent.declarations[
          parent.declarations.findIndex((declaration) => declaration === node)
        ];

        parent.declarations = parent.declarations.filter(
          (declaration) => declaration
        );
      } else {
        Object.assign(parent, {
          type: "EmptyStatement",
        });
      }
    }

    return this.imports;
  }
}

export default ImportParser;
