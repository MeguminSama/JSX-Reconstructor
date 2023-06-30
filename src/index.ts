import * as acorn from "acorn";
import * as walk from "acorn-walk";
import acornJSX from "acorn-jsx";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import path from "path";
import {
  Program,
  CallExpression,
  MemberExpression,
  SequenceExpression,
  UnaryExpression,
  FunctionDeclaration,
  BlockStatement,
  Node,
  Identifier,
} from "estree";
import * as recast from "recast";
import * as prettier from "prettier";

const parser = acorn.Parser.extend(acornJSX());

const files = readdirSync(path.join(process.cwd(), "input")).filter((f) =>
  f.endsWith(".js")
);

if (!existsSync(path.join(process.cwd(), "output"))) {
  mkdirSync(path.join(process.cwd(), "output"));
}

for (const file of files) {
  try {
    console.log(file);
    const filePath = path.join(process.cwd(), "input", file);
    const data = readFileSync(filePath, "utf-8");
    const ast = parser.parse(data, {
      sourceType: "module",
      ecmaVersion: "latest",
    });
    writeFileSync(
      path.join(process.cwd(), "output", `${file}x`),
      prettier.format(recast.print(parseModule(ast)).code, { parser: "babel" })
    );
  } catch (e) {
    console.log(`error: ${e.toString()}`);
  }
}

function parseModule(node: acorn.Node) {
  const program = node as unknown as Program;
  const customJSXRuntime = program.body.find(
    (statement) =>
      statement.type === "FunctionDeclaration" && isCustomJSXRuntime(statement)
  )! as FunctionDeclaration; // what

  walk.ancestor(node, {
    // @ts-ignore weird typing issues...
    MemberExpression(node: MemberExpression, ancestors: Node[]) {
      if (
        node.object.type === "Identifier" &&
        // node.object.name === "React" &&
        node.property.type === "Identifier" &&
        node.property.name === "createElement"
      ) {
        const parent = ancestors[ancestors.length - 2];
        if (parent.type !== "CallExpression") return;

        const callExpression = parent as CallExpression;
        const [component, originalProps, ...children]: any[] =
          callExpression.arguments;

        let componentName = recast.print(component).code;
        componentName = componentName.replace(/^"/, "").replace(/"$/, "");

        const selfClosing =
          children.filter((child) =>
            child.type === "UnaryExpression"
              ? (child as UnaryExpression).operator !== "void"
              : child
          ).length === 0;

        const attributes: any[] = parseComponentProps(originalProps);

        const jsxElement = {
          type: "JSXElement",
          openingElement: {
            type: "JSXOpeningElement",
            name: {
              type: "JSXIdentifier",
              name: componentName,
            },
            attributes: attributes,
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
          children: children.map((c) => {
            if (c.type === "Identifier" || c.type.endsWith("Expression")) {
              return {
                type: "JSXExpressionContainer",
                expression: c,
              };
            }
            return c;
          }),
        };

        Object.assign(parent, jsxElement);
      }
    },

    // @ts-ignore
    CallExpression(_node: CallExpression, ancestors: Node[]) {
      const parent = ancestors[ancestors.length - 2];
      if (parent.type !== "ReturnStatement") return;

      const recurse: (node: CallExpression) => any = (node: CallExpression) => {
        if (
          // node.object.name === "React" &&
          isJSXRuntime(node.callee, customJSXRuntime)
        ) {
          const [component, originalProps, ...children]: any[] = node.arguments;

          let componentName = recast.print(component).code;
          componentName = componentName.replace(/^"/, "").replace(/"$/, "");

          const selfClosing =
            children.filter((child) =>
              child.type === "UnaryExpression"
                ? (child as UnaryExpression).operator !== "void"
                : child
            ).length === 0;

          const attributes: any[] = parseComponentProps(originalProps);

          const jsxElement: any = {
            type: "JSXElement",
            openingElement: {
              type: "JSXOpeningElement",
              name: {
                type: "JSXIdentifier",
                name: componentName,
              },
              attributes: attributes,
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
            children: children
              .map((c) => {
                if (
                  c.type === "Identifier" ||
                  (c.type.endsWith("Expression") &&
                    c.type !== "CallExpression" &&
                    c.type !== "ConditionalExpression" &&
                    c.type !== "LogicalExpression" &&
                    c.operator !== "void")
                ) {
                  return {
                    type: "JSXExpressionContainer",
                    expression: c,
                  };
                } else if (c.type === "CallExpression") {
                  return recurse(c);
                } else if (c.type === "ConditionalExpression") {
                  return {
                    type: "JSXExpressionContainer",
                    expression: Object.assign(c, {
                      consequent:
                        c.consequent.type === "CallExpression"
                          ? recurse(c.consequent)
                          : c,
                      alternate:
                        c.alternate.type === "CallExpression"
                          ? recurse(c.alternate)
                          : c,
                    }),
                  };
                } else if (c.type === "LogicalExpression") {
                  return {
                    type: "JSXExpressionContainer",
                    expression: Object.assign(c, {
                      left:
                        c.left.type === "CallExpression"
                          ? recurse(c.left)
                          : c.left,
                      right:
                        c.right.type === "CallExpression"
                          ? recurse(c.right)
                          : c.right,
                    }),
                  };
                }

                return c.operator !== "void" ? c : null; // i see void 0 in my nightmares
              })
              .filter((c) => c),
          };

          return jsxElement;
        } else {
          return node;
        }
      };

      Object.assign(parent, { argument: recurse(_node) });
    },

    // @ts-ignore
    SequenceExpression(node: SequenceExpression, ancestors: Node[]) {
      const proxiedMemberExpression = node.expressions[1]! as MemberExpression;
      if (
        proxiedMemberExpression &&
        proxiedMemberExpression.object &&
        proxiedMemberExpression.object.type === "Identifier" &&
        // node.object.name === "React" &&
        proxiedMemberExpression.property.type === "Identifier" &&
        (proxiedMemberExpression.property.name.endsWith("jsx") ||
          proxiedMemberExpression.property.name.endsWith("jsxs"))
      ) {
        const parent = ancestors[ancestors.length - 2];
        if (parent.type !== "CallExpression") return;

        const callExpression = parent as CallExpression;
        const [component, originalProps, ...children]: any[] =
          callExpression.arguments;

        let componentName = recast.print(component).code;
        componentName = componentName.replace(/^"/, "").replace(/"$/, "");

        const selfClosing =
          children.filter((child) =>
            child.type === "UnaryExpression"
              ? (child as UnaryExpression).operator !== "void"
              : child
          ).length === 0;

        const attributes: any[] = parseComponentProps(originalProps);

        const jsxElement = {
          type: "JSXElement",
          openingElement: {
            type: "JSXOpeningElement",
            name: {
              type: "JSXIdentifier",
              name: componentName,
            },
            attributes: attributes,
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
          children: children.map((c) => {
            if (c.type === "Identifier" || c.type.endsWith("Expression")) {
              return {
                type: "JSXExpressionContainer",
                expression: c,
              };
            }
            return c;
          }),
        };

        Object.assign(parent, jsxElement);
      } else {
        const parent = ancestors[ancestors.length - 2];
        if (parent.type !== "CallExpression") return;

        Object.assign(parent, { callee: proxiedMemberExpression });
      }
    },
  });

  return node;
}

function isJSXRuntime(node: Node, fallback?: FunctionDeclaration) {
  return (
    (node.type === "SequenceExpression" &&
      ((
        (node.expressions[1]! as MemberExpression).property as Identifier
      ).name.endsWith("jsx") ||
        (
          (node.expressions[1]! as MemberExpression).property as Identifier
        ).name.endsWith("jsxs") ||
        (fallback &&
          ((node.expressions[1]! as MemberExpression).property as Identifier)
            .name === fallback.id!.name))) ||
    (node.type === "MemberExpression" &&
      ((node.property as Identifier).name.endsWith("jsx") ||
        (node.property as Identifier).name.endsWith("jsxs") ||
        (fallback &&
          (node.property as Identifier).name === fallback.id!.name))) ||
    (node.type === "Identifier" &&
      (node.name.endsWith("jsx") ||
        node.name.endsWith("jsxs") ||
        (fallback && node.name === fallback.id!.name)))
  );
}

function isCustomJSXRuntime(node: FunctionDeclaration) {
  const blockStatement = node.body as BlockStatement;
  return blockStatement.body.find(
    (statement) =>
      statement.type === "ExpressionStatement" &&
      statement.expression.type === "LogicalExpression" &&
      statement.expression.right.type === "AssignmentExpression" &&
      statement.expression.right.right.type === "LogicalExpression" &&
      statement.expression.right.right.left.type === "LogicalExpression" &&
      statement.expression.right.right.left.right.type === "CallExpression" &&
      statement.expression.right.right.left.right.arguments.find(
        (expression: Node) =>
          expression.type === "Literal" && expression.value === "react.element"
      )
  );
}

function isSpreadOperator(node: CallExpression) {
  return (
    (node.callee.type === "Identifier" ||
      node.callee.type === "SequenceExpression" ||
      node.callee.type === "MemberExpression") &&
    node.arguments.length >= 2
  );
}

///
/// Spread operators end up like Y({}, props, {[key]: value})
/// This is equivalent to:
/// Object.assign({}, props, {[key]: value})
/// So we want to turn it into:
/// { ...props, [key]: value }
function parseSpreadOperator(node: CallExpression) {
  const returnNodes: any[] = [];

  for (const argument of node.arguments) {
    if (argument.type === "Identifier") {
      returnNodes.push({
        type: "JSXSpreadAttribute",
        argument,
      });
      continue;
    }
    returnNodes.push(...parseComponentProps(argument, true));
  }

  return returnNodes;
}

function parseComponentProps(originalProps: any, inSpread = false) {
  const attributes: any[] = [];

  if (!originalProps) {
    return [];
  }

  if (originalProps.type === "ObjectExpression") {
    for (const prop of originalProps.properties) {
      if (prop.type !== "Property") {
        console.error(prop);
        throw new Error();
      }

      const type = "JSXAttribute";
      const name = {
        type: "JSXIdentifier",
        name: prop.key.name || prop.key.value,
      };

      if (!name.name) console.log(prop);

      const value = prop.value;
      attributes.push({
        type,
        name,
        value: { type: "JSXExpressionContainer", expression: value },
      });
    }
  } else if (originalProps.type === "Identifier") {
    attributes.push({
      type: "JSXSpreadAttribute",
      argument: originalProps,
    });
  } else if (originalProps.type === "Literal") {
    if (originalProps.value === null) {
      // do nothing
    } else {
      // console.log(originalProps);
      // attributes.push(originalProps);
      // throw new Error();
    }
  } else if (originalProps.type === "CallExpression") {
    if (isSpreadOperator(originalProps) && !inSpread) {
      const op = parseSpreadOperator(originalProps);
      attributes.push(...op);
    } else {
      attributes.push({
        type: "JSXSpreadAttribute",
        argument: originalProps,
      });
      // throw new Error();
    }
  } else if (originalProps.type === "Property") {
    let key = "";
    if (originalProps.key.type === "Identifier") {
      key = originalProps.key.name;
    } else if (originalProps.key.type === "Literal") {
      key = originalProps.key.value;
    } else {
      console.log(originalProps);
      throw new Error();
    }

    let value = {
      type: "Literal",
      value: originalProps.value.value,
    };
    if (originalProps.value.type !== "Literal") {
      value = {
        type: "JSXExpressionContainer",
        // @ts-ignore
        expression: originalProps.value,
      };
    }

    attributes.push({
      type: "JSXAttribute",
      name: {
        type: "JSXIdentifier",
        name: key,
      },
      value,
    });
  } else if (originalProps.type === "MemberExpression") {
    attributes.push({
      type: "JSXSpreadAttribute",
      argument: {
        type: "Identifier",
        name: recast.print(originalProps).code,
      },
    });
  } else if (originalProps.type === "ConditionalExpression") {
    attributes.push({
      type: "JSXSpreadAttribute",
      argument: originalProps,
    });
  } else if (originalProps.type === "LogicalExpression") {
    attributes.push({
      type: "JSXSpreadAttribute",
      argument: originalProps,
    });
  } else {
    if (inSpread) {
      attributes.push({
        type: "JSXSpreadAttribute",
        argument: originalProps,
      });
    } else {
      throw new Error();
    }
  }

  return attributes;
}
