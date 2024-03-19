import {
  BlockStatement,
  CallExpression,
  FunctionDeclaration,
  Identifier,
  MemberExpression,
  Node,
  ReturnStatement,
  UnaryExpression,
} from "estree";
import * as recast from "recast";

import { parseComponentProps, getChildrenFromProps, stripProps } from "./utils";

class CallParser {
  customJSXRuntime: FunctionDeclaration | null | undefined;

  constructor(customJSXRuntime: FunctionDeclaration | null | undefined) {
    this.customJSXRuntime = customJSXRuntime;
  }

  isJSXRuntime(node: Node): boolean {
    return !!(
      (node.type === "SequenceExpression" &&
        ((
          (node.expressions[1]! as MemberExpression).property as Identifier
        ).name.endsWith("jsx") ||
          (
            (node.expressions[1]! as MemberExpression).property as Identifier
          ).name.endsWith("jsxs") ||
          (
            (node.expressions[1]! as MemberExpression).property as Identifier
          ).name.endsWith("jsxDEV") ||
          (
            (node.expressions[1]! as MemberExpression).property as Identifier
          ).name.endsWith("jsxsDEV") ||
          (this.customJSXRuntime &&
            ((node.expressions[1]! as MemberExpression).property as Identifier)
              .name === this.customJSXRuntime.id!.name))) ||
      (node.type === "MemberExpression" &&
        (((node.property as Identifier).name === "createElement" &&
          !(
            node.object.type === "Identifier" && node.object.name === "document"
          )) ||
          (node.property as Identifier).name?.endsWith("jsx") ||
          (node.property as Identifier).name?.endsWith("jsxs") ||
          (node.property as Identifier).name?.endsWith("jsxDEV") ||
          (node.property as Identifier).name?.endsWith("jsxsDEV") ||
          (this.customJSXRuntime &&
            (node.property as Identifier).name ===
              this.customJSXRuntime.id!.name))) ||
      (node.type === "Identifier" &&
        (node.name.endsWith("jsx") ||
          node.name.endsWith("jsxs") ||
          node.name.endsWith("jsxDEV") ||
          node.name.endsWith("jsxsDEV") ||
          (this.customJSXRuntime &&
            node.name === this.customJSXRuntime.id!.name)))
    );
  }

  recurse(node: CallExpression): Node {
    // console.log(node, this.isJSXRuntime(node.callee));
    if (this.isJSXRuntime(node.callee)) {
      const [component, originalProps, ..._children]: any[] = node.arguments;
      const children =
        (node.callee.type === "SequenceExpression" &&
          ((
            (node.callee.expressions[1]! as MemberExpression)
              .property as Identifier
          ).name.endsWith("jsxDEV") ||
            (
              (node.callee.expressions[1]! as MemberExpression)
                .property as Identifier
            ).name.endsWith("jsxsDEV"))) ||
        (node.callee.type === "MemberExpression" &&
          ((node.callee.property as Identifier).name?.endsWith("jsxDEV") ||
            (node.callee.property as Identifier).name?.endsWith("jsxsDEV"))) ||
        (node.callee.type === "Identifier" &&
          (node.callee.name.endsWith("jsxDEV") ||
            node.callee.name.endsWith("jsxsDEV")))
          ? _children.filter((_, i) => i + 4 < _children.length)
          : _children;

      // These are always defined in source code as `createElement(...)` instead of with JSX
      if (
        component.type === "CallExpression" ||
        component.type === "BinaryExpression"
      ) {
        return node;
      }

      let componentName =
        component.type === "CallExpression"
          ? recast.print(component.callee).code
          : recast.print(component).code;

      componentName = componentName.replace(/^"/, "").replace(/"$/, "");

      const attributes: any[] = parseComponentProps(originalProps);
      const realChildren = [
        ...children.filter((child) =>
          child.type === "UnaryExpression"
            ? (child as UnaryExpression).operator !== "void"
            : child
        ),
        ...getChildrenFromProps(attributes, this),
      ];

      const selfClosing = realChildren.length === 0;

      const jsxElement: any = {
        type: "JSXElement",
        openingElement: {
          type: "JSXOpeningElement",
          name: {
            type: "JSXIdentifier",
            name: componentName,
          },
          attributes: stripProps(attributes),
          selfClosing: selfClosing,
        },
        closingElement: selfClosing
          ? null
          : {
              type: "JSXClosingElement",
              name: {
                type: "JSXIdentifier",
                name: componentName,
              },
            },
        children: realChildren.map((c: Node) => {
          switch (c.type) {
            case "Identifier": {
              return {
                type: "JSXExpressionContainer",
                expression: c,
              };
            }

            case "CallExpression": {
              return this.isJSXRuntime(c.callee)
                ? this.recurse(c)
                : {
                    type: "JSXExpressionContainer",
                    expression: c,
                  };
            }

            case "ConditionalExpression": {
              return {
                type: "JSXExpressionContainer",
                expression: Object.assign(c, {
                  consequent:
                    c.consequent.type === "CallExpression"
                      ? this.recurse(c.consequent)
                      : c.consequent,
                  alternate:
                    c.alternate.type === "CallExpression"
                      ? this.recurse(c.alternate)
                      : c.alternate,
                }),
              };
            }

            case "LogicalExpression": {
              return {
                type: "JSXExpressionContainer",
                expression: Object.assign(c, {
                  left:
                    c.left.type === "CallExpression"
                      ? this.recurse(c.left)
                      : c.left,
                  right:
                    c.right.type === "CallExpression"
                      ? this.recurse(c.right)
                      : c.right,
                }),
              };
            }

            case "UnaryExpression": {
              if (c.operator === "void") {
                return {
                  type: "EmptyStatement",
                };
              }

              return c;
            }

            case "Literal": {
              if (typeof c.value === "string" && /[}{]/.test(c.value)) {
                return {
                  type: "JSXExpressionContainer",
                  expression: {
                    type: "TemplateLiteral",
                    expressions: [],
                    quasis: [
                      {
                        type: "TemplateElement",
                        value: {
                          raw: c.value,
                          cooked: c.value,
                        },
                      },
                    ],
                  },
                };
              }
            }

            default: {
              if (c.type.endsWith("Expression")) {
                return {
                  type: "JSXExpressionContainer",
                  expression: c,
                };
              }

              return c;
            }
          }
        }),
      };

      return jsxElement;
    } else {
      return node;
    }
  }

  parse(node: CallExpression, parent: Node): Node {
    // accounts for other parent types, rather than just ReturnStatement. if there are still instances of _jsx calls left over, you can uncomment the lines in the default case
    switch (parent.type) {
      case "ReturnStatement": {
        return {
          ...parent,
          argument: this.recurse(node) as unknown as any,
        };
      }

      case "VariableDeclarator": {
        return {
          ...parent,
          init: this.recurse(node) as unknown as any,
        };
      }

      case "AssignmentExpression": {
        if (!this.isJSXRuntime(node.callee)) return parent;
        let matchingKey;

        Object.keys(parent).forEach((key) => {
          if ((parent as any)[key] == node) {
            matchingKey = key;
            // console.log(`[+] found matching property: "${key}"`);
          }
        });

        if (!matchingKey) return parent;

        const parentClone: any = { ...parent };
        parentClone[matchingKey] = this.recurse(node) as unknown as any;

        return parentClone;
      }

      case "ConditionalExpression": {
        if (!this.isJSXRuntime(node.callee)) return parent;
        let matchingKey;

        Object.keys(parent).forEach((key) => {
          if ((parent as any)[key] == node) {
            matchingKey = key;
            // console.log(`[+] found matching property: "${key}"`);
          }
        });

        if (!matchingKey) return parent;

        const parentClone: any = { ...parent };
        parentClone[matchingKey] = this.recurse(node) as unknown as any;

        return parentClone;
      }

      case "LogicalExpression": {
        if (!this.isJSXRuntime(node.callee)) return parent;
        let matchingKey;

        Object.keys(parent).forEach((key) => {
          if ((parent as any)[key] == node) {
            matchingKey = key;
            // console.log(`[+] found matching property: "${key}"`);
          }
        });

        if (!matchingKey) return parent;

        const parentClone: any = { ...parent };
        parentClone[matchingKey] = this.recurse(node) as unknown as any;

        return parentClone;
      }

      case "ArrayExpression": {
        if (!this.isJSXRuntime(node.callee)) return parent;
        const elements = [...parent.elements];
        const index = elements.indexOf(node);

        elements[index] = this.recurse(node) as unknown as any;

        return {
          ...parent,
          elements: elements,
        };
      }

      case "ArrowFunctionExpression": {
        if (!this.isJSXRuntime(node.callee)) return parent;
        let matchingKey;

        Object.keys(parent).forEach((key) => {
          if ((parent as any)[key] == node) {
            matchingKey = key;
            // console.log(`[+] found matching property: "${key}"`);
          }
        });

        if (!matchingKey) return parent;

        const parentClone: any = { ...parent };
        parentClone[matchingKey] = this.recurse(node) as unknown as any;

        return parentClone;
      }

      // @ts-ignore
      case "ParenthesizedExpression": {
        if (!this.isJSXRuntime(node.callee)) return parent;
        return this.recurse(node) as unknown as any;
      }

      case "CallExpression": {
        // this will be random, leftover _jsx calls because the actual conversion happens later in the process
        return parent;
      }

      // @ts-ignore
      case "JSXElement": {
        // same as CallExpression, will be recursed
        return parent;
      }

      case "SequenceExpression": {
        // already accounted for in index.ts
        return parent;
      }

      case "Property": {
        // god bless dziurwa for helping me find this bug with _jsxDEV calls where it doesn't get parsed for SOME REASON????
        return parent;
      }

      default: {
        if (this.isJSXRuntime(node.callee)) {
          console.log(
            `[-] unknown node type ${parent.type}, ${recast.print(parent).code}`
          );
        }
      }
    }

    return parent;
  }
}

export default CallParser;
