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
import { CallExpression, MemberExpression, Node } from "estree";
import * as recast from "recast";

const parser = acorn.Parser.extend(acornJSX());

const files = readdirSync(path.join(process.cwd(), "input")).filter((f) =>
  f.endsWith(".js")
);

if (!existsSync(path.join(process.cwd(), "output"))) {
  mkdirSync(path.join(process.cwd(), "output"));
}

for (const file of files) {
  // if (file !== "1445.js") continue; // DEBUG
  console.log(file);
  const filePath = path.join(process.cwd(), "input", file);
  const data = readFileSync(filePath, "utf-8");
  const ast = parser.parse(data, {
    sourceType: "module",
    ecmaVersion: "latest",
  });
  writeFileSync(
    path.join(process.cwd(), "output", `${file}x`),
    recast.print(parseModule(ast)).code
  );
}

function parseModule(node: acorn.Node) {
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

        const selfClosing = children.length === 0;

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
  });

  return node;
}

function isSpreadOperator(node: CallExpression) {
  return (
    (node.callee.type === "Identifier" ||
      node.callee.type === "SequenceExpression") &&
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

      const isSelfIdentifying =
        prop.value.type === "Identifier" && prop.value.name === prop.key.name;

      const value = isSelfIdentifying ? null : prop.value;
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
