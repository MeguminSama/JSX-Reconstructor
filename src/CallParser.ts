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
import { JsxElement } from "typescript";

import { parseComponentProps } from "./utils";

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
					(this.customJSXRuntime &&
						((node.expressions[1]! as MemberExpression).property as Identifier)
							.name === this.customJSXRuntime.id!.name))) ||
			(node.type === "MemberExpression" &&
				((node.property as Identifier).name === "createElement" ||
					(node.property as Identifier).name?.endsWith("jsx") ||
					(node.property as Identifier).name?.endsWith("jsxs") ||
					(this.customJSXRuntime &&
						(node.property as Identifier).name ===
						this.customJSXRuntime.id!.name))) ||
			(node.type === "Identifier" &&
				(node.name === "createElement" ||
					node.name.endsWith("jsx") ||
					node.name.endsWith("jsxs") ||
					(this.customJSXRuntime &&
						node.name === this.customJSXRuntime.id!.name)))
		);
	}

	recurse(node: CallExpression): Node {
		if (
			this.isJSXRuntime(node.callee)
		) {
			const [component, originalProps, ...children]: any[] = node.arguments;

			// These are always defined in source code as `createElement(...)` instead of with JSX
			if (component.type === "CallExpression" || component.type === "BinaryExpression") {
				return node;
			}

			let componentName = component.type === "CallExpression"
				? recast.print(component.callee).code
				: recast.print(component).code;

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
				children: children.map((c: Node) => {
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

						// @ts-ignore
						case "JSXElement": {
							return this.recurse(c);
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
												}
											}
										]
									}
								}
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

	parse(node: CallExpression, parent: ReturnStatement): ReturnStatement {
		return {
			...parent,
			argument: this.recurse(node) as unknown as any,
		};
	}
}

export default CallParser;
