import {
  Identifier,
  MemberExpression,
  VariableDeclarator,
  VariableDeclaration,
  ClassDeclaration,
  MethodDefinition,
  Node,
  FunctionExpression,
  CallExpression,
  FunctionDeclaration,
  ReturnStatement,
  Statement,
  NewExpression,
} from "estree";
import * as walk from "acorn-walk";
import * as recast from "recast";

import { ParenthesizedExpression } from ".";

export enum ClassType {
  Invalid = -1,
  Class = 0,
  ParenthesizedClass = 1,
  WrappedClass = 2,
  NewClass = 3,
}

class ClassParser {
  mirroredProperties: Identifier[];
  mirroredSelfProperties: {
    identifier: Identifier;
    memberExpression: MemberExpression;
  }[];
  getters: MethodDefinition[];
  candidateMap: Map<
    string,
    { proto: VariableDeclaration; constructor: FunctionDeclaration }
  >;

  constructor() {
    this.mirroredProperties = [];
    this.mirroredSelfProperties = [];
    this.getters = [];
    this.candidateMap = new Map();
  }

  getClassType(node: VariableDeclarator): ClassType {
    if (
      node.id &&
      node.id.type === "Identifier" &&
      node.init &&
      (node.init.type === "CallExpression" ||
        node.init.type === "NewExpression") &&
      node.init.callee
    ) {
      if (
        (node.init.callee as any as ParenthesizedExpression).type ===
          "ParenthesizedExpression" &&
        (node.init.callee as any as ParenthesizedExpression).expression &&
        (node.init.callee as any as ParenthesizedExpression).expression.type ===
          "CallExpression" &&
        (
          (node.init.callee as any as ParenthesizedExpression)
            .expression as any as CallExpression
        ).callee.type === "FunctionExpression" &&
        (
          (
            (node.init.callee as any as ParenthesizedExpression)
              .expression as any as CallExpression
          ).callee as any as FunctionExpression
        ).params.length === node.init.arguments.length &&
        (
          (
            (node.init.callee as any as ParenthesizedExpression)
              .expression as any as CallExpression
          ).callee as any as FunctionExpression
        ).body.body[0].type === "ExpressionStatement"
      ) {
        return ClassType.NewClass;
      }

      if (
        (node.init.callee as any as ParenthesizedExpression).type ===
          "ParenthesizedExpression" &&
        (node.init.callee as any as ParenthesizedExpression).expression &&
        (node.init.callee as any as ParenthesizedExpression).expression.type ===
          "FunctionExpression" &&
        (
          (node.init.callee as any as ParenthesizedExpression)
            .expression as any as FunctionExpression
        ).params.length === node.init.arguments.length &&
        (
          (node.init.callee as any as ParenthesizedExpression)
            .expression as any as FunctionExpression
        ).body.body[0].type === "ExpressionStatement"
      ) {
        return ClassType.ParenthesizedClass;
      }

      if (node.init.callee.type === "FunctionExpression") {
        const constructorCandidates = node.init.callee.body.body.filter(
          (statement) => statement.type === "FunctionDeclaration"
        ) as any[] as FunctionDeclaration[];

        for (const candidate of constructorCandidates) {
          if (!(candidate.id && candidate.id.type === "Identifier")) continue;

          const protoNode =
            node.init.callee.body.body[
              node.init.callee.body.body.indexOf(candidate) + 1
            ];

          if (
            !(
              protoNode &&
              protoNode.type === "VariableDeclaration" &&
              protoNode.declarations[0].init &&
              protoNode.declarations[0].init.type === "MemberExpression" &&
              protoNode.declarations[0].init.object &&
              protoNode.declarations[0].init.object.type === "Identifier" &&
              protoNode.declarations[0].init.object.name ===
                candidate.id.name &&
              protoNode.declarations[0].init.property &&
              protoNode.declarations[0].init.property.type === "Identifier" &&
              protoNode.declarations[0].init.property.name === "prototype"
            )
          )
            continue;

          if (
            node.init.callee.body.body[node.init.callee.body.body.length - 1]
              .type === "ReturnStatement"
          ) {
            const returnStatement = node.init.callee.body.body[
              node.init.callee.body.body.length - 1
            ] as ReturnStatement;

            if (
              !(
                returnStatement.argument &&
                returnStatement.argument.type === "Identifier"
              )
            )
              continue;

            const returnArgument = returnStatement.argument! as Identifier;

            if (returnArgument.name === candidate.id.name) {
              this.candidateMap.set(node.id.name, {
                proto: protoNode,
                constructor: candidate,
              });
              return ClassType.Class;
            }
          }
        }

        return ClassType.Invalid;
      }
    }

    return ClassType.Invalid;
  }

  parse(
    node: VariableDeclarator,
    parent: VariableDeclaration
  ): ClassDeclaration {
    const classType = this.getClassType(node);

    const walkBase = {
      ...walk.base,
      JSXElement(node: Node, state: any, callback: any) {},
    };

    switch (classType) {
      case ClassType.Class: {
        const name = (node.id as any as Identifier).name;

        const rawFunction = (node.init as any as CallExpression)
          .callee as any as FunctionExpression;

        const functionBody = (
          (node.init as any as CallExpression)
            .callee as any as FunctionExpression
        ).body.body;

        const protoIdentifier = (
          this.candidateMap.get(name)!.proto.declarations[0]
            .id as any as Identifier
        ).name;

        const classConstructor = this.candidateMap.get(name)!.constructor;

        const superClass =
          functionBody[0].type === "ExpressionStatement" &&
          functionBody[0].expression.type === "CallExpression" &&
          functionBody[0].expression.arguments.length === 2 &&
          functionBody[0].expression.arguments[0] &&
          functionBody[0].expression.arguments[0].type === "Identifier" &&
          functionBody[0].expression.arguments[0].name === name
            ? (node.init as CallExpression).arguments[0]
            : null;

        const fixConstructorReferences = (
          functionExpression: FunctionExpression
        ) => {
          // @ts-ignore
          walk.ancestor(
            // @ts-ignore
            functionExpression as any,
            {
              // @ts-ignore
              MemberExpression(node: MemberExpression, ancestors: Node[]) {
                if (
                  node.object &&
                  node.property &&
                  node.property.type === "Identifier" &&
                  node.property.name === "constructor"
                ) {
                  Object.assign(node, node.object);
                }

                if (
                  node.object &&
                  node.object.type === "Identifier" &&
                  node.object.name === name
                ) {
                  Object.assign(node, { object: { type: "ThisExpression" } });
                }

                if (
                  superClass &&
                  node.object &&
                  recast.print(node.object).code ===
                    recast.print(superClass).code
                ) {
                  Object.assign(node, { object: { type: "Super" } });
                }
              },
            },
            walkBase
          );

          return functionExpression;
        };

        const parseFunctionBody = (functionExpression: FunctionExpression) => {
          const functionBody = functionExpression.body.body;

          let thisProps: string;
          let thisConstructor: string;
          let thisMirror: string;

          for (const node of functionBody) {
            switch (node.type) {
              case "VariableDeclaration": {
                for (const declarator of node.declarations) {
                  if (
                    declarator.id &&
                    declarator.id.type === "Identifier" &&
                    declarator.init &&
                    declarator.init.type === "MemberExpression" &&
                    declarator.init.object &&
                    declarator.init.object.type === "ThisExpression" &&
                    declarator.init.property &&
                    declarator.init.property.type === "Identifier" &&
                    declarator.init.property.name === "props"
                  ) {
                    thisProps = declarator.id.name;

                    if (node.declarations.length > 1) {
                      delete node.declarations[
                        node.declarations.indexOf(declarator)
                      ];
                    } else {
                      delete functionBody[functionBody.indexOf(node)];
                    }
                  }

                  if (
                    declarator.id &&
                    declarator.id.type === "Identifier" &&
                    declarator.init &&
                    declarator.init.type === "MemberExpression" &&
                    declarator.init.object &&
                    declarator.init.object.type === "ThisExpression" &&
                    declarator.init.property &&
                    declarator.init.property.type === "Identifier" &&
                    declarator.init.property.name === "constructor"
                  ) {
                    thisConstructor = declarator.id.name;

                    if (node.declarations.length > 1) {
                      delete node.declarations[
                        node.declarations.indexOf(declarator)
                      ];
                    } else {
                      delete functionBody[functionBody.indexOf(node)];
                    }
                  }

                  if (
                    declarator.id &&
                    declarator.id.type === "Identifier" &&
                    declarator.init &&
                    declarator.init.type === "ThisExpression"
                  ) {
                    thisMirror = declarator.id.name;

                    if (node.declarations.length > 1) {
                      delete node.declarations[
                        node.declarations.indexOf(declarator)
                      ];
                    } else {
                      delete functionBody[functionBody.indexOf(node)];
                    }
                  }
                }

                node.declarations = node.declarations.filter(
                  (declarator) => declarator !== null
                ); // having null in the declarations array fucks up recast, don't do that :3

                // @ts-ignore
                walk.ancestor(
                  // @ts-ignore
                  {
                    ...functionExpression,
                    body: {
                      ...functionExpression.body,
                      body: functionBody.filter((statement) => statement),
                    },
                  } as any,
                  {
                    // @ts-ignore
                    MemberExpression(
                      node: MemberExpression,
                      ancestors: Node[]
                    ) {
                      if (
                        thisProps &&
                        node.object &&
                        node.object.type === "Identifier" &&
                        node.object.name === thisProps
                      ) {
                        Object.assign(node, {
                          object: {
                            type: "MemberExpression",
                            object: { type: "ThisExpression" },
                            property: {
                              type: "Identifier",
                              name: "props",
                            },
                          },
                        });
                      }

                      if (
                        thisConstructor &&
                        node.object &&
                        node.object.type === "Identifier" &&
                        node.object.name === thisConstructor
                      ) {
                        Object.assign(node, {
                          object: { type: "ThisExpression" },
                        });
                      }

                      if (
                        thisMirror &&
                        node.object &&
                        node.object.type === "Identifier" &&
                        node.object.name === thisMirror
                      ) {
                        Object.assign(node, {
                          object: { type: "ThisExpression" },
                        });
                      }

                      if (
                        node.object &&
                        node.object.type === "ThisExpression" &&
                        node.property &&
                        node.property.type === "Identifier" &&
                        node.property.name === "constructor"
                      ) {
                        Object.assign(node, {
                          type: "ThisExpression",
                        });
                      }
                    },

                    // @ts-ignore
                    Identifier(node: Identifier, ancestors: Node[]) {
                      if (
                        superClass &&
                        rawFunction.params[0] &&
                        rawFunction.params[0].type === "Identifier" &&
                        node.name === rawFunction.params[0].name
                      ) {
                        Object.assign(node, superClass);
                      }
                    },
                  },
                  walkBase
                );

                // @ts-ignore
                walk.ancestor(
                  // @ts-ignore
                  {
                    ...functionExpression,
                    body: {
                      ...functionExpression.body,
                      body: functionBody.filter((statement) => statement),
                    },
                  } as any,
                  {
                    // @ts-ignore
                    MemberExpression(
                      node: MemberExpression,
                      ancestors: Node[]
                    ) {
                      if (
                        node.object &&
                        node.object.type === "ThisExpression" &&
                        node.property &&
                        node.property.type === "Identifier" &&
                        node.property.name === "constructor"
                      ) {
                        Object.assign(node, {
                          type: "ThisExpression",
                        });
                      }
                    },
                  },
                  walkBase
                );

                break;
              }
            }
          }
          return functionBody.filter((statement) => statement !== null);
        };

        const parseConstructor = (functionExpression: FunctionExpression) => {
          const functionBody = functionExpression.body.body;
          let functionBodyClone: Statement[] = functionBody;

          let isSpread: boolean = false;

          const lastNode =
            functionExpression.body.body[
              functionExpression.body.body.length - 1
            ];

          if (
            superClass &&
            functionBody[0].type === "VariableDeclaration" &&
            functionBody[0].declarations[0] &&
            functionBody[0].declarations[0].id.type === "Identifier" &&
            functionBody[1].type === "ForStatement" &&
            functionBody[2].type === "ExpressionStatement" &&
            functionBody[2].expression.type === "AssignmentExpression" &&
            functionBody[2].expression.right.type === "LogicalExpression" &&
            functionBody[2].expression.right.left.type === "CallExpression" &&
            functionBody[2].expression.right.operator === "||" &&
            functionBody[2].expression.right.right.type === "ThisExpression" &&
            lastNode.type === "ReturnStatement" &&
            lastNode.argument &&
            lastNode.argument.type === "Identifier" &&
            lastNode.argument.name ===
              functionBody[0].declarations[0].id.name &&
            functionExpression.params.length === 0
          ) {
            // args are spread :husk:
            isSpread = true;

            const _this = functionBody[0].declarations[0].id.name;

            functionBodyClone = functionBody.slice(3);
            functionBodyClone.pop();

            functionBodyClone = [
              {
                type: "ExpressionStatement",
                expression: {
                  type: "CallExpression",
                  callee: { type: "Super" },
                  arguments: [
                    {
                      type: "SpreadElement",
                      argument: { type: "Identifier", name: "args" },
                    },
                  ],
                  optional: false,
                },
              },
              ...functionBodyClone,
            ];

            // @ts-ignore
            walk.ancestor(
              // @ts-ignore
              {
                ...functionExpression,
                body: {
                  ...functionExpression.body,
                  body: functionBodyClone,
                },
              } as any,
              {
                // @ts-ignore
                Identifier(node: Identifier, ancestors: Node[]) {
                  if (node.name === _this) {
                    Object.assign(node, { type: "ThisExpression" });
                  }
                },
              },
              walkBase
            );
          }

          if (
            superClass &&
            functionBody[0].type === "VariableDeclaration" &&
            functionBody[0].declarations[0] &&
            functionBody[0].declarations[0].id.type === "Identifier" &&
            functionBody[1].type === "ExpressionStatement" &&
            functionBody[1].expression.type === "AssignmentExpression" &&
            functionBody[1].expression.right.type === "LogicalExpression" &&
            functionBody[1].expression.right.left.type === "CallExpression" &&
            functionBody[1].expression.right.left.callee.type ===
              "MemberExpression" &&
            recast.print(functionBody[1].expression.right.left.callee.object)
              .code === recast.print(superClass).code &&
            functionBody[1].expression.right.operator === "||" &&
            functionBody[1].expression.right.right.type === "ThisExpression" &&
            lastNode.type === "ReturnStatement" &&
            lastNode.argument &&
            lastNode.argument.type === "Identifier" &&
            lastNode.argument.name === functionBody[0].declarations[0].id.name
          ) {
            const _this = functionBody[0].declarations[0].id.name;
            const _super = functionBody[1].expression.right.left;

            const superArgs = _super.arguments;
            superArgs.shift();

            functionBodyClone = functionBody.slice(2);
            functionBodyClone.pop();

            functionBodyClone = [
              {
                type: "ExpressionStatement",
                expression: {
                  type: "CallExpression",
                  callee: { type: "Super" },
                  arguments: superArgs,
                  optional: false,
                },
              },
              ...functionBodyClone,
            ];

            // @ts-ignore
            walk.ancestor(
              // @ts-ignore
              {
                ...functionExpression,
                body: {
                  ...functionExpression.body,
                  body: functionBodyClone,
                },
              } as any,
              {
                // @ts-ignore
                Identifier(node: Identifier, ancestors: Node[]) {
                  if (node.name === _this) {
                    Object.assign(node, { type: "ThisExpression" });
                  }
                },
              },
              walkBase
            );
          }

          // @ts-ignore
          walk.ancestor(
            // @ts-ignore
            {
              ...functionExpression,
              body: {
                ...functionExpression.body,
                body: functionBodyClone,
              },
            } as any,
            {
              // @ts-ignore
              FunctionExpression(node: FunctionExpression, ancestors: Node[]) {
                Object.assign(node, {
                  ...node,
                  body: {
                    ...node.body,
                    body: parseFunctionBody(node),
                  },
                } as any);
              },
            },
            walkBase
          );

          return {
            ...functionExpression,
            params: isSpread
              ? [
                  {
                    type: "RestElement",
                    argument: { type: "Identifier", name: "args" },
                  },
                ]
              : functionExpression.params,
            body: {
              ...functionExpression.body,
              body: functionBodyClone,
            },
          };
        };

        return {
          ...parent,
          type: "ClassDeclaration",
          id: {
            type: "Identifier",
            name,
          },
          superClass,
          body: {
            type: "ClassBody",
            body: [
              classConstructor.body.body[0] &&
                classConstructor.body.body[0].type !== "ReturnStatement" && {
                  type: "MethodDefinition",
                  static: false,
                  computed: false,
                  key: {
                    type: "Identifier",
                    name: "constructor",
                  },
                  kind: "method",
                  value: fixConstructorReferences(
                    parseConstructor({
                      ...classConstructor,
                      type: "FunctionExpression",
                      id: null,
                      body: {
                        ...classConstructor.body,
                        body: parseFunctionBody(
                          classConstructor as any as FunctionExpression
                        ),
                      },
                    }) as any
                  ),
                },
              ...functionBody.map((statement) => {
                switch (statement.type) {
                  case "ExpressionStatement": {
                    if (
                      statement.expression.type === "AssignmentExpression" &&
                      statement.expression.left &&
                      statement.expression.left.type === "MemberExpression" &&
                      statement.expression.left.object &&
                      statement.expression.left.object.type === "Identifier" &&
                      (statement.expression.left.object.name ===
                        protoIdentifier ||
                        (classConstructor.id &&
                          statement.expression.left.object.name ===
                            classConstructor.id.name)) &&
                      statement.expression.left.property &&
                      statement.expression.left.property.type ===
                        "Identifier" &&
                      statement.expression.right &&
                      statement.expression.right.type === "FunctionExpression"
                    ) {
                      const functionName =
                        statement.expression.left.property.name;
                      const functionExpression = statement.expression.right;

                      return {
                        type: "MethodDefinition",
                        static:
                          classConstructor.id &&
                          statement.expression.left.object.name ===
                            classConstructor.id.name
                            ? true
                            : false,
                        computed: false,
                        key: {
                          type: "Identifier",
                          name: functionName,
                        },
                        kind: "method",
                        value: fixConstructorReferences({
                          ...functionExpression,
                          id: null,
                          body: {
                            ...functionExpression.body,
                            body: parseFunctionBody(functionExpression),
                          },
                        }),
                      } as any as MethodDefinition;
                    }
                  }
                }
              }),
            ].filter((statement) => statement),
          },
        } as any as ClassDeclaration;
      }

      case ClassType.ParenthesizedClass: {
        const name = (node.id as any as Identifier).name;

        const rawFunction = (
          (node.init as any as CallExpression)
            .callee as any as ParenthesizedExpression
        ).expression as any as FunctionExpression;

        const functionBody = (
          (
            (node.init as any as CallExpression)
              .callee as any as ParenthesizedExpression
          ).expression as any as FunctionExpression
        ).body.body;

        const protoIdentifier = (
          (functionBody[2] as any as VariableDeclaration).declarations[0]
            .id as any as Identifier
        ).name;

        const classConstructor = functionBody[1] as any as FunctionDeclaration;

        const superClass =
          functionBody[0].type === "ExpressionStatement" &&
          functionBody[0].expression.type === "CallExpression" &&
          functionBody[0].expression.arguments.length === 2 &&
          functionBody[0].expression.arguments[0] &&
          functionBody[0].expression.arguments[0].type === "Identifier" &&
          functionBody[0].expression.arguments[0].name === name
            ? (node.init as CallExpression).arguments[0]
            : null;

        const fixConstructorReferences = (
          functionExpression: FunctionExpression
        ) => {
          // @ts-ignore
          walk.ancestor(
            // @ts-ignore
            functionExpression as any,
            {
              // @ts-ignore
              MemberExpression(node: MemberExpression, ancestors: Node[]) {
                if (
                  node.object &&
                  node.property &&
                  node.property.type === "Identifier" &&
                  node.property.name === "constructor"
                ) {
                  Object.assign(node, node.object);
                }

                if (
                  node.object &&
                  node.object.type === "Identifier" &&
                  node.object.name === name
                ) {
                  Object.assign(node, { object: { type: "ThisExpression" } });
                }

                if (
                  superClass &&
                  rawFunction.params[0] &&
                  rawFunction.params[0].type === "Identifier" &&
                  node.object &&
                  node.object.type === "Identifier" &&
                  node.object.name === rawFunction.params[0].name
                ) {
                  Object.assign(node, { object: { type: "Super" } });
                }
              },
            },
            walkBase
          );

          return functionExpression;
        };

        const parseFunctionBody = (functionExpression: FunctionExpression) => {
          const functionBody = functionExpression.body.body;

          let thisProps: string;
          let thisConstructor: string;
          let thisMirror: string;

          for (const node of functionBody) {
            switch (node.type) {
              case "VariableDeclaration": {
                for (const declarator of node.declarations) {
                  if (
                    declarator.id &&
                    declarator.id.type === "Identifier" &&
                    declarator.init &&
                    declarator.init.type === "MemberExpression" &&
                    declarator.init.object &&
                    declarator.init.object.type === "ThisExpression" &&
                    declarator.init.property &&
                    declarator.init.property.type === "Identifier" &&
                    declarator.init.property.name === "props"
                  ) {
                    thisProps = declarator.id.name;

                    if (node.declarations.length > 1) {
                      delete node.declarations[
                        node.declarations.indexOf(declarator)
                      ];
                    } else {
                      delete functionBody[functionBody.indexOf(node)];
                    }
                  }

                  if (
                    declarator.id &&
                    declarator.id.type === "Identifier" &&
                    declarator.init &&
                    declarator.init.type === "MemberExpression" &&
                    declarator.init.object &&
                    declarator.init.object.type === "ThisExpression" &&
                    declarator.init.property &&
                    declarator.init.property.type === "Identifier" &&
                    declarator.init.property.name === "constructor"
                  ) {
                    thisConstructor = declarator.id.name;

                    if (node.declarations.length > 1) {
                      delete node.declarations[
                        node.declarations.indexOf(declarator)
                      ];
                    } else {
                      delete functionBody[functionBody.indexOf(node)];
                    }
                  }

                  if (
                    declarator.id &&
                    declarator.id.type === "Identifier" &&
                    declarator.init &&
                    declarator.init.type === "ThisExpression"
                  ) {
                    thisMirror = declarator.id.name;

                    if (node.declarations.length > 1) {
                      delete node.declarations[
                        node.declarations.indexOf(declarator)
                      ];
                    } else {
                      delete functionBody[functionBody.indexOf(node)];
                    }
                  }
                }

                node.declarations = node.declarations.filter(
                  (declarator) => declarator !== null
                ); // having null in the declarations array fucks up recast, don't do that :3

                // @ts-ignore
                walk.ancestor(
                  // @ts-ignore
                  {
                    ...functionExpression,
                    body: {
                      ...functionExpression.body,
                      body: functionBody.filter((statement) => statement),
                    },
                  } as any,
                  {
                    // @ts-ignore
                    MemberExpression(
                      node: MemberExpression,
                      ancestors: Node[]
                    ) {
                      if (
                        thisProps &&
                        node.object &&
                        node.object.type === "Identifier" &&
                        node.object.name === thisProps
                      ) {
                        Object.assign(node, {
                          object: {
                            type: "MemberExpression",
                            object: { type: "ThisExpression" },
                            property: {
                              type: "Identifier",
                              name: "props",
                            },
                          },
                        });
                      }

                      if (
                        thisConstructor &&
                        node.object &&
                        node.object.type === "Identifier" &&
                        node.object.name === thisConstructor
                      ) {
                        Object.assign(node, {
                          object: { type: "ThisExpression" },
                        });
                      }

                      if (
                        thisMirror &&
                        node.object &&
                        node.object.type === "Identifier" &&
                        node.object.name === thisMirror
                      ) {
                        Object.assign(node, {
                          object: { type: "ThisExpression" },
                        });
                      }

                      if (
                        node.object &&
                        node.object.type === "ThisExpression" &&
                        node.property &&
                        node.property.type === "Identifier" &&
                        node.property.name === "constructor"
                      ) {
                        Object.assign(node, {
                          type: "ThisExpression",
                        });
                      }
                    },

                    // @ts-ignore
                    Identifier(node: Identifier, ancestors: Node[]) {
                      if (
                        superClass &&
                        rawFunction.params[0] &&
                        rawFunction.params[0].type === "Identifier" &&
                        node.name === rawFunction.params[0].name
                      ) {
                        Object.assign(node, superClass);
                      }
                    },
                  },
                  walkBase
                );

                // @ts-ignore
                walk.ancestor(
                  // @ts-ignore
                  {
                    ...functionExpression,
                    body: {
                      ...functionExpression.body,
                      body: functionBody.filter((statement) => statement),
                    },
                  } as any,
                  {
                    // @ts-ignore
                    MemberExpression(
                      node: MemberExpression,
                      ancestors: Node[]
                    ) {
                      if (
                        node.object &&
                        node.object.type === "ThisExpression" &&
                        node.property &&
                        node.property.type === "Identifier" &&
                        node.property.name === "constructor"
                      ) {
                        Object.assign(node, {
                          type: "ThisExpression",
                        });
                      }
                    },
                  },
                  walkBase
                );

                break;
              }
            }
          }
          return functionBody.filter((statement) => statement !== null);
        };

        const parseConstructor = (functionExpression: FunctionExpression) => {
          const functionBody = functionExpression.body.body;
          let functionBodyClone: Statement[] = functionBody;

          let isSpread: boolean = false;

          const lastNode =
            functionExpression.body.body[
              functionExpression.body.body.length - 1
            ];

          if (
            superClass &&
            functionBody[0].type === "VariableDeclaration" &&
            functionBody[0].declarations[0] &&
            functionBody[0].declarations[0].id.type === "Identifier" &&
            functionBody[1].type === "ForStatement" &&
            functionBody[2].type === "ExpressionStatement" &&
            functionBody[2].expression.type === "AssignmentExpression" &&
            functionBody[2].expression.right.type === "LogicalExpression" &&
            functionBody[2].expression.right.left.type === "CallExpression" &&
            functionBody[2].expression.right.operator === "||" &&
            functionBody[2].expression.right.right.type === "ThisExpression" &&
            lastNode.type === "ReturnStatement" &&
            lastNode.argument &&
            lastNode.argument.type === "Identifier" &&
            lastNode.argument.name ===
              functionBody[0].declarations[0].id.name &&
            functionExpression.params.length === 0
          ) {
            // args are spread :husk:
            isSpread = true;

            const _this = functionBody[0].declarations[0].id.name;

            functionBodyClone = functionBody.slice(3);
            functionBodyClone.pop();

            functionBodyClone = [
              {
                type: "ExpressionStatement",
                expression: {
                  type: "CallExpression",
                  callee: { type: "Super" },
                  arguments: [
                    {
                      type: "SpreadElement",
                      argument: { type: "Identifier", name: "args" },
                    },
                  ],
                  optional: false,
                },
              },
              ...functionBodyClone,
            ];

            // @ts-ignore
            walk.ancestor(
              // @ts-ignore
              {
                ...functionExpression,
                body: {
                  ...functionExpression.body,
                  body: functionBodyClone,
                },
              } as any,
              {
                // @ts-ignore
                Identifier(node: Identifier, ancestors: Node[]) {
                  if (node.name === _this) {
                    Object.assign(node, { type: "ThisExpression" });
                  }
                },
              },
              walkBase
            );
          }

          if (
            superClass &&
            functionBody[0].type === "VariableDeclaration" &&
            functionBody[0].declarations[0] &&
            functionBody[0].declarations[0].id.type === "Identifier" &&
            functionBody[1].type === "ExpressionStatement" &&
            functionBody[1].expression.type === "AssignmentExpression" &&
            functionBody[1].expression.right.type === "LogicalExpression" &&
            functionBody[1].expression.right.left.type === "CallExpression" &&
            functionBody[1].expression.right.left.callee.type ===
              "MemberExpression" &&
            recast.print(functionBody[1].expression.right.left.callee.object)
              .code === recast.print(superClass).code &&
            functionBody[1].expression.right.operator === "||" &&
            functionBody[1].expression.right.right.type === "ThisExpression" &&
            lastNode.type === "ReturnStatement" &&
            lastNode.argument &&
            lastNode.argument.type === "Identifier" &&
            lastNode.argument.name === functionBody[0].declarations[0].id.name
          ) {
            const _this = functionBody[0].declarations[0].id.name;
            const _super = functionBody[1].expression.right.left;

            const superArgs = _super.arguments;
            superArgs.shift();

            functionBodyClone = functionBody.slice(2);
            functionBodyClone.pop();

            functionBodyClone = [
              {
                type: "ExpressionStatement",
                expression: {
                  type: "CallExpression",
                  callee: { type: "Super" },
                  arguments: superArgs,
                  optional: false,
                },
              },
              ...functionBodyClone,
            ];

            // @ts-ignore
            walk.ancestor(
              // @ts-ignore
              {
                ...functionExpression,
                body: {
                  ...functionExpression.body,
                  body: functionBodyClone,
                },
              } as any,
              {
                // @ts-ignore
                Identifier(node: Identifier, ancestors: Node[]) {
                  if (node.name === _this) {
                    Object.assign(node, { type: "ThisExpression" });
                  }
                },
              },
              walkBase
            );
          }

          // @ts-ignore
          walk.ancestor(
            // @ts-ignore
            {
              ...functionExpression,
              body: {
                ...functionExpression.body,
                body: functionBodyClone,
              },
            } as any,
            {
              // @ts-ignore
              FunctionExpression(node: FunctionExpression, ancestors: Node[]) {
                Object.assign(node, {
                  ...node,
                  body: {
                    ...node.body,
                    body: parseFunctionBody(node),
                  },
                } as any);
              },
            },
            walkBase
          );

          return {
            ...functionExpression,
            params: isSpread
              ? [
                  {
                    type: "RestElement",
                    argument: { type: "Identifier", name: "args" },
                  },
                ]
              : functionExpression.params,
            body: {
              ...functionExpression.body,
              body: functionBodyClone,
            },
          };
        };

        return {
          ...parent,
          type: "ClassDeclaration",
          id: {
            type: "Identifier",
            name,
          },
          superClass,
          body: {
            type: "ClassBody",
            body: [
              classConstructor.body.body[0] &&
                classConstructor.body.body[0].type !== "ReturnStatement" && {
                  type: "MethodDefinition",
                  static: false,
                  computed: false,
                  key: {
                    type: "Identifier",
                    name: "constructor",
                  },
                  kind: "method",
                  value: fixConstructorReferences(
                    parseConstructor({
                      ...classConstructor,
                      type: "FunctionExpression",
                      id: null,
                      body: {
                        ...classConstructor.body,
                        body: parseFunctionBody(
                          classConstructor as any as FunctionExpression
                        ),
                      },
                    }) as any
                  ),
                },
              ...functionBody.map((statement) => {
                switch (statement.type) {
                  case "ExpressionStatement": {
                    if (
                      statement.expression.type === "AssignmentExpression" &&
                      statement.expression.left &&
                      statement.expression.left.type === "MemberExpression" &&
                      statement.expression.left.object &&
                      statement.expression.left.object.type === "Identifier" &&
                      (statement.expression.left.object.name ===
                        protoIdentifier ||
                        (classConstructor.id &&
                          statement.expression.left.object.name ===
                            classConstructor.id.name)) &&
                      statement.expression.left.property &&
                      statement.expression.left.property.type ===
                        "Identifier" &&
                      statement.expression.right &&
                      statement.expression.right.type === "FunctionExpression"
                    ) {
                      const functionName =
                        statement.expression.left.property.name;
                      const functionExpression = statement.expression.right;

                      return {
                        type: "MethodDefinition",
                        static:
                          classConstructor.id &&
                          statement.expression.left.object.name ===
                            classConstructor.id.name
                            ? true
                            : false,
                        computed: false,
                        key: {
                          type: "Identifier",
                          name: functionName,
                        },
                        kind: "method",
                        value: fixConstructorReferences({
                          ...functionExpression,
                          id: null,
                          body: {
                            ...functionExpression.body,
                            body: parseFunctionBody(functionExpression),
                          },
                        }),
                      } as any as MethodDefinition;
                    }
                  }
                }
              }),
            ].filter((statement) => statement),
          },
        } as any as ClassDeclaration;
      }

      case ClassType.NewClass: {
        const name = (node.id as any as Identifier).name;

        const rawFunction = (
          (
            (node.init as any as NewExpression)
              .callee as any as ParenthesizedExpression
          ).expression as any as CallExpression
        ).callee as any as FunctionExpression;

        const functionBody = (
          (
            (
              (node.init as any as NewExpression)
                .callee as any as ParenthesizedExpression
            ).expression as any as CallExpression
          ).callee as any as FunctionExpression
        ).body.body;

        const protoIdentifier = (
          (functionBody[2] as any as VariableDeclaration).declarations[0]
            .id as any as Identifier
        ).name;

        const classConstructor = functionBody[1] as any as FunctionDeclaration;

        const superClass =
          classConstructor.id &&
          functionBody[0].type === "ExpressionStatement" &&
          functionBody[0].expression.type === "CallExpression" &&
          functionBody[0].expression.arguments.length === 2 &&
          functionBody[0].expression.arguments[0] &&
          recast.print(functionBody[0].expression.arguments[0]).code ===
            recast.print(classConstructor.id).code
            ? (
                (
                  (node.init as any as NewExpression)
                    .callee as any as ParenthesizedExpression
                ).expression as any as CallExpression
              ).arguments[0]
            : null;

        const fixConstructorReferences = (
          functionExpression: FunctionExpression
        ) => {
          // @ts-ignore
          walk.ancestor(
            // @ts-ignore
            functionExpression as any,
            {
              // @ts-ignore
              MemberExpression(node: MemberExpression, ancestors: Node[]) {
                if (
                  node.object &&
                  node.property &&
                  node.property.type === "Identifier" &&
                  node.property.name === "constructor"
                ) {
                  Object.assign(node, node.object);
                }

                if (
                  node.object &&
                  node.object.type === "Identifier" &&
                  node.object.name === name
                ) {
                  Object.assign(node, { object: { type: "ThisExpression" } });
                }

                if (
                  superClass &&
                  rawFunction.params[0] &&
                  rawFunction.params[0].type === "Identifier" &&
                  node.object &&
                  node.object.type === "Identifier" &&
                  node.object.name === rawFunction.params[0].name
                ) {
                  Object.assign(node, { object: { type: "Super" } });
                }
              },
            },
            walkBase
          );

          return functionExpression;
        };

        const parseFunctionBody = (functionExpression: FunctionExpression) => {
          const functionBody = functionExpression.body.body;

          let thisProps: string;
          let thisConstructor: string;
          let thisMirror: string;

          for (const node of functionBody) {
            switch (node.type) {
              case "VariableDeclaration": {
                for (const declarator of node.declarations) {
                  if (
                    declarator.id &&
                    declarator.id.type === "Identifier" &&
                    declarator.init &&
                    declarator.init.type === "MemberExpression" &&
                    declarator.init.object &&
                    declarator.init.object.type === "ThisExpression" &&
                    declarator.init.property &&
                    declarator.init.property.type === "Identifier" &&
                    declarator.init.property.name === "props"
                  ) {
                    thisProps = declarator.id.name;

                    if (node.declarations.length > 1) {
                      delete node.declarations[
                        node.declarations.indexOf(declarator)
                      ];
                    } else {
                      delete functionBody[functionBody.indexOf(node)];
                    }
                  }

                  if (
                    declarator.id &&
                    declarator.id.type === "Identifier" &&
                    declarator.init &&
                    declarator.init.type === "MemberExpression" &&
                    declarator.init.object &&
                    declarator.init.object.type === "ThisExpression" &&
                    declarator.init.property &&
                    declarator.init.property.type === "Identifier" &&
                    declarator.init.property.name === "constructor"
                  ) {
                    thisConstructor = declarator.id.name;

                    if (node.declarations.length > 1) {
                      delete node.declarations[
                        node.declarations.indexOf(declarator)
                      ];
                    } else {
                      delete functionBody[functionBody.indexOf(node)];
                    }
                  }

                  if (
                    declarator.id &&
                    declarator.id.type === "Identifier" &&
                    declarator.init &&
                    declarator.init.type === "ThisExpression"
                  ) {
                    thisMirror = declarator.id.name;

                    if (node.declarations.length > 1) {
                      delete node.declarations[
                        node.declarations.indexOf(declarator)
                      ];
                    } else {
                      delete functionBody[functionBody.indexOf(node)];
                    }
                  }
                }

                node.declarations = node.declarations.filter(
                  (declarator) => declarator !== null
                ); // having null in the declarations array fucks up recast, don't do that :3

                // @ts-ignore
                walk.ancestor(
                  // @ts-ignore
                  {
                    ...functionExpression,
                    body: {
                      ...functionExpression.body,
                      body: functionBody.filter((statement) => statement),
                    },
                  } as any,
                  {
                    // @ts-ignore
                    MemberExpression(
                      node: MemberExpression,
                      ancestors: Node[]
                    ) {
                      if (
                        thisProps &&
                        node.object &&
                        node.object.type === "Identifier" &&
                        node.object.name === thisProps
                      ) {
                        Object.assign(node, {
                          object: {
                            type: "MemberExpression",
                            object: { type: "ThisExpression" },
                            property: {
                              type: "Identifier",
                              name: "props",
                            },
                          },
                        });
                      }

                      if (
                        thisConstructor &&
                        node.object &&
                        node.object.type === "Identifier" &&
                        node.object.name === thisConstructor
                      ) {
                        Object.assign(node, {
                          object: { type: "ThisExpression" },
                        });
                      }

                      if (
                        thisMirror &&
                        node.object &&
                        node.object.type === "Identifier" &&
                        node.object.name === thisMirror
                      ) {
                        Object.assign(node, {
                          object: { type: "ThisExpression" },
                        });
                      }

                      if (
                        node.object &&
                        node.object.type === "ThisExpression" &&
                        node.property &&
                        node.property.type === "Identifier" &&
                        node.property.name === "constructor"
                      ) {
                        Object.assign(node, {
                          type: "ThisExpression",
                        });
                      }
                    },

                    // @ts-ignore
                    Identifier(node: Identifier, ancestors: Node[]) {
                      if (
                        superClass &&
                        rawFunction.params[0] &&
                        rawFunction.params[0].type === "Identifier" &&
                        node.name === rawFunction.params[0].name
                      ) {
                        Object.assign(node, superClass);
                      }
                    },
                  },
                  walkBase
                );

                // @ts-ignore
                walk.ancestor(
                  // @ts-ignore
                  {
                    ...functionExpression,
                    body: {
                      ...functionExpression.body,
                      body: functionBody.filter((statement) => statement),
                    },
                  } as any,
                  {
                    // @ts-ignore
                    MemberExpression(
                      node: MemberExpression,
                      ancestors: Node[]
                    ) {
                      if (
                        node.object &&
                        node.object.type === "ThisExpression" &&
                        node.property &&
                        node.property.type === "Identifier" &&
                        node.property.name === "constructor"
                      ) {
                        Object.assign(node, {
                          type: "ThisExpression",
                        });
                      }
                    },
                  },
                  walkBase
                );

                break;
              }
            }
          }
          return functionBody.filter((statement) => statement !== null);
        };

        const parseConstructor = (functionExpression: FunctionExpression) => {
          const functionBody = functionExpression.body.body;
          let functionBodyClone: Statement[] = functionBody;

          let isSpread: boolean = false;

          const lastNode =
            functionExpression.body.body[
              functionExpression.body.body.length - 1
            ];

          if (
            superClass &&
            functionBody[0].type === "VariableDeclaration" &&
            functionBody[0].declarations[0] &&
            functionBody[0].declarations[0].id.type === "Identifier" &&
            functionBody[1].type === "ForStatement" &&
            functionBody[2].type === "ExpressionStatement" &&
            functionBody[2].expression.type === "AssignmentExpression" &&
            functionBody[2].expression.right.type === "LogicalExpression" &&
            functionBody[2].expression.right.left.type === "CallExpression" &&
            functionBody[2].expression.right.operator === "||" &&
            functionBody[2].expression.right.right.type === "ThisExpression" &&
            lastNode.type === "ReturnStatement" &&
            lastNode.argument &&
            lastNode.argument.type === "Identifier" &&
            lastNode.argument.name ===
              functionBody[0].declarations[0].id.name &&
            functionExpression.params.length === 0
          ) {
            // args are spread :husk:
            isSpread = true;

            const _this = functionBody[0].declarations[0].id.name;

            functionBodyClone = functionBody.slice(3);
            functionBodyClone.pop();

            functionBodyClone = [
              {
                type: "ExpressionStatement",
                expression: {
                  type: "CallExpression",
                  callee: { type: "Super" },
                  arguments: [
                    {
                      type: "SpreadElement",
                      argument: { type: "Identifier", name: "args" },
                    },
                  ],
                  optional: false,
                },
              },
              ...functionBodyClone,
            ];

            // @ts-ignore
            walk.ancestor(
              // @ts-ignore
              {
                ...functionExpression,
                body: {
                  ...functionExpression.body,
                  body: functionBodyClone,
                },
              } as any,
              {
                // @ts-ignore
                Identifier(node: Identifier, ancestors: Node[]) {
                  if (node.name === _this) {
                    Object.assign(node, { type: "ThisExpression" });
                  }
                },
              },
              walkBase
            );
          }

          if (
            superClass &&
            functionBody[0].type === "VariableDeclaration" &&
            functionBody[0].declarations[0] &&
            functionBody[0].declarations[0].id.type === "Identifier" &&
            functionBody[1].type === "ExpressionStatement" &&
            functionBody[1].expression.type === "AssignmentExpression" &&
            functionBody[1].expression.right.type === "LogicalExpression" &&
            functionBody[1].expression.right.left.type === "CallExpression" &&
            functionBody[1].expression.right.left.callee.type ===
              "MemberExpression" &&
            recast.print(functionBody[1].expression.right.left.callee.object)
              .code === recast.print(superClass).code &&
            functionBody[1].expression.right.operator === "||" &&
            functionBody[1].expression.right.right.type === "ThisExpression" &&
            lastNode.type === "ReturnStatement" &&
            lastNode.argument &&
            lastNode.argument.type === "Identifier" &&
            lastNode.argument.name === functionBody[0].declarations[0].id.name
          ) {
            const _this = functionBody[0].declarations[0].id.name;
            const _super = functionBody[1].expression.right.left;

            const superArgs = _super.arguments;
            superArgs.shift();

            functionBodyClone = functionBody.slice(2);
            functionBodyClone.pop();

            functionBodyClone = [
              {
                type: "ExpressionStatement",
                expression: {
                  type: "CallExpression",
                  callee: { type: "Super" },
                  arguments: superArgs,
                  optional: false,
                },
              },
              ...functionBodyClone,
            ];

            // @ts-ignore
            walk.ancestor(
              // @ts-ignore
              {
                ...functionExpression,
                body: {
                  ...functionExpression.body,
                  body: functionBodyClone,
                },
              } as any,
              {
                // @ts-ignore
                Identifier(node: Identifier, ancestors: Node[]) {
                  if (node.name === _this) {
                    Object.assign(node, { type: "ThisExpression" });
                  }
                },
              },
              walkBase
            );
          }

          // @ts-ignore
          walk.ancestor(
            // @ts-ignore
            {
              ...functionExpression,
              body: {
                ...functionExpression.body,
                body: functionBodyClone,
              },
            } as any,
            {
              // @ts-ignore
              FunctionExpression(node: FunctionExpression, ancestors: Node[]) {
                Object.assign(node, {
                  ...node,
                  body: {
                    ...node.body,
                    body: parseFunctionBody(node),
                  },
                } as any);
              },
            },
            walkBase
          );

          return {
            ...functionExpression,
            params: isSpread
              ? [
                  {
                    type: "RestElement",
                    argument: { type: "Identifier", name: "args" },
                  },
                ]
              : functionExpression.params,
            body: {
              ...functionExpression.body,
              body: functionBodyClone,
            },
          };
        };

        const declaratorIndex = parent.declarations.indexOf(node);
        const otherDeclarations = parent.declarations.filter(
          (_, i) => i !== declaratorIndex
        );

        return {
          ...parent,
          declarations: [
            ...otherDeclarations,
            {
              ...node,
              init: {
                ...node.init,
                callee: {
                  type: "ClassDeclaration",
                  id: {
                    type: "Identifier",
                    name,
                  },
                  superClass,
                  body: {
                    type: "ClassBody",
                    body: [
                      classConstructor.body.body[0] &&
                        classConstructor.body.body[0].type !==
                          "ReturnStatement" && {
                          type: "MethodDefinition",
                          static: false,
                          computed: false,
                          key: {
                            type: "Identifier",
                            name: "constructor",
                          },
                          kind: "method",
                          value: fixConstructorReferences(
                            parseConstructor({
                              ...classConstructor,
                              type: "FunctionExpression",
                              id: null,
                              body: {
                                ...classConstructor.body,
                                body: parseFunctionBody(
                                  classConstructor as any as FunctionExpression
                                ),
                              },
                            }) as any
                          ),
                        },
                      ...functionBody.map((statement) => {
                        switch (statement.type) {
                          case "ExpressionStatement": {
                            if (
                              statement.expression.type ===
                                "AssignmentExpression" &&
                              statement.expression.left &&
                              statement.expression.left.type ===
                                "MemberExpression" &&
                              statement.expression.left.object &&
                              statement.expression.left.object.type ===
                                "Identifier" &&
                              (statement.expression.left.object.name ===
                                protoIdentifier ||
                                (classConstructor.id &&
                                  statement.expression.left.object.name ===
                                    classConstructor.id.name)) &&
                              statement.expression.left.property &&
                              statement.expression.left.property.type ===
                                "Identifier" &&
                              statement.expression.right &&
                              statement.expression.right.type ===
                                "FunctionExpression"
                            ) {
                              const functionName =
                                statement.expression.left.property.name;
                              const functionExpression =
                                statement.expression.right;

                              return {
                                type: "MethodDefinition",
                                static:
                                  classConstructor.id &&
                                  statement.expression.left.object.name ===
                                    classConstructor.id.name
                                    ? true
                                    : false,
                                computed: false,
                                key: {
                                  type: "Identifier",
                                  name: functionName,
                                },
                                kind: "method",
                                value: fixConstructorReferences({
                                  ...functionExpression,
                                  id: null,
                                  body: {
                                    ...functionExpression.body,
                                    body: parseFunctionBody(functionExpression),
                                  },
                                }),
                              } as any as MethodDefinition;
                            }
                          }
                        }
                      }),
                    ].filter((statement) => statement),
                  },
                },
              },
            },
          ],
        } as any as ClassDeclaration;
      }
    }

    return parent as unknown as ClassDeclaration;
  }
}

export default ClassParser;
