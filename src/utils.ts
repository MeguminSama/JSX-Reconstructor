import {
  FunctionDeclaration,
  BlockStatement,
  UnaryExpression,
  CallExpression,
  Node,
  ObjectExpression,
  Property,
  Identifier,
} from "estree";
import * as recast from "recast";
import CallParser from "./CallParser";

export function isBooleanOperator(node: UnaryExpression) {
  return (
    node.type === "UnaryExpression" &&
    node.operator === "!" &&
    node.argument.type === "Literal" &&
    typeof node.argument.value === "number"
  );
}

export function isSpreadOperator(node: CallExpression): boolean {
  return !!(
    node.callee &&
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

export function parseSpreadOperator(node: CallExpression): any[] {
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

export function parseComponentProps(
  originalProps: any,
  inSpread = false
): any[] {
  const attributes: any[] = [];

  if (!originalProps) {
    return [];
  }

  switch (originalProps.type) {
    case "ObjectExpression": {
      for (const prop of originalProps.properties) {
        if (prop.type === "SpreadElement") {
          attributes.push({
            type: "JSXSpreadAttribute",
            argument: prop.argument,
          });
          continue;
        }
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

      break;
    }

    case "Identifier": {
      attributes.push({
        type: "JSXSpreadAttribute",
        argument: originalProps,
      });

      break;
    }

    case "CallExpression": {
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

      break;
    }

    case "Property": {
      let key = "";
      if (originalProps.key && originalProps.value) {
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
      }

      break;
    }

    case "MemberExpression": {
      attributes.push({
        type: "JSXSpreadAttribute",
        argument: {
          type: "Identifier",
          name: recast.print(originalProps).code,
        },
      });

      break;
    }

    case "ConditionalExpression": {
      attributes.push({
        type: "JSXSpreadAttribute",
        argument: originalProps,
      });

      break;
    }

    case "LogicalExpression": {
      attributes.push({
        type: "JSXSpreadAttribute",
        argument: originalProps,
      });

      break;
    }

    default: {
      if (inSpread) {
        attributes.push({
          type: "JSXSpreadAttribute",
          argument: originalProps,
        });
      } else {
        /* empty */
      }
    }
  }

  return attributes;
}

export function isCustomJSXRuntime(node: FunctionDeclaration): boolean {
  const blockStatement = node.body as BlockStatement;
  return !!blockStatement.body.find(
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

export function pushWithoutDuplicates(array: any[], ...items: any[]): void {
  for (const item of items) {
    if (!array.includes(item)) {
      array.push(item);
    }
  }
}

export function getChildrenFromProps(props: any[], callParser: CallParser) {
  const propsObject: any = {};
  props.forEach((prop) => {
    if (prop.type === "JSXAttribute") propsObject[prop.name.name] = prop.value;

    if (prop.type === "ObjectExpression") {
      const object = prop as ObjectExpression;

      for (const property of object.properties) {
        const realProperty = property as Property;
        const propertyId = realProperty.key as Identifier;
        propsObject[propertyId.name] = realProperty.value;
      }
    }
  });

  if (
    propsObject.children &&
    propsObject.children.type === "ExpressionStatement" &&
    propsObject.children.expression.type === "ArrayExpression"
  ) {
    return propsObject.children.expression.elements;
  } else if (
    propsObject.children &&
    propsObject.children.type === "JSXExpressionContainer"
  ) {
    if (propsObject.children.expression.type === "CallExpression") {
      return [callParser.recurse(propsObject.children.expression)];
    } else if (propsObject.children.expression.type === "ArrayExpression") {
      return propsObject.children.expression.elements;
    } else {
      return [];
    }
  } else {
    return [];
  }
}

export function stripProps(props: any[]) {
  const propsObject: any = {};
  props.forEach((prop) => {
    if (prop.type === "JSXAttribute") propsObject[prop.name.name] = prop.value;
  });

  return props.filter(
    (prop) => !(prop.type === "JSXAttribute" && prop.name.name === "children")
  );
}
