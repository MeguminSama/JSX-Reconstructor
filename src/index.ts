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
	MethodDefinition,
	BlockStatement,
	ExpressionStatement,
	Literal,
	Identifier,
	VariableDeclarator,
	Node,
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
	} catch (e: any) {
		console.log(`error: ${e.toString()}`);
	}
}

function parseModule(node: acorn.Node) {
	var program = node as unknown as Program;

	const customJSXRuntime = program.body.find(
		(statement) =>
			statement.type === "FunctionDeclaration" && isCustomJSXRuntime(statement)
	)! as FunctionDeclaration; // what

	const recurseCallExpression: (node: CallExpression) => any = (
		node: CallExpression
	) => {
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
				children: children.map((c) => {
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
						return isJSXRuntime(c.callee, customJSXRuntime)
							? recurseCallExpression(c)
							: {
									type: "JSXExpressionContainer",
									expression: c,
							  };
					} else if (c.type === "ConditionalExpression") {
						return {
							type: "JSXExpressionContainer",
							expression: Object.assign(c, {
								consequent:
									c.consequent.type === "CallExpression"
										? recurseCallExpression(c.consequent)
										: c,
								alternate:
									c.alternate.type === "CallExpression"
										? recurseCallExpression(c.alternate)
										: c,
							}),
						};
					} else if (c.type === "LogicalExpression") {
						return {
							type: "JSXExpressionContainer",
							expression: Object.assign(c, {
								left:
									c.left.type === "CallExpression"
										? recurseCallExpression(c.left)
										: c.left,
								right:
									c.right.type === "CallExpression"
										? recurseCallExpression(c.right)
										: c.right,
							}),
						};
					}

					return c.operator !== "void"
						? c
						: Object.assign(c, {
								type: "EmptyStatement",
						  }); // i see void 0 in my nightmares
				}),
			};

			return jsxElement;
		} else {
			return node;
		}
	};

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
		VariableDeclarator(node: VariableDeclarator, ancestors: Node[]) {
			const parent = ancestors[ancestors.length - 2];
			if (parent.type !== "VariableDeclaration") return;

			const mirroredProperties = [] as Identifier[];

			if (
				node.id &&
				node.id.type === "Identifier" &&
				node.init &&
				node.init.type === "CallExpression" &&
				node.init.callee &&
				node.init.callee.type === "FunctionExpression" &&
				node.init.callee.params.length === node.init.arguments.length &&
				node.init.callee.body.body[0].type === "ExpressionStatement"
			) {
				node.init.callee.body.body.shift();

				node.init.callee.body.body.map((expression) => {
					switch (expression.type) {
						case "FunctionDeclaration": {
							if (
								expression.body.body[0] &&
								expression.body.body[0].type === "ReturnStatement"
							) {
								return Object.assign(expression, {
									type: "EmptyStatement",
								});
							} else if (
								node.id.type === "Identifier" &&
								node.id.name === expression.id!.name
							) {
								var superDeclaratorCopy: any;
								var superDeclarator = expression.body.body.find(
									(superExpression) => {
										return (
											superExpression.type === "ExpressionStatement" &&
											superExpression.expression.type ===
												"AssignmentExpression" &&
											superExpression.expression.right.type ===
												"LogicalExpression" &&
											superExpression.expression.right.left.type ===
												"CallExpression" &&
											superExpression.expression.right.left.callee.type ===
												"MemberExpression" &&
											superExpression.expression.right.left.callee.object
												.type === "Identifier" &&
											node.id &&
											node.id.type === "Identifier" &&
											node.init &&
											node.init.type === "CallExpression" &&
											node.init.callee &&
											node.init.callee.type === "FunctionExpression" &&
											node.init.callee.params[0] &&
											node.init.callee.params[0].type === "Identifier" &&
											superExpression.expression.right.left.callee.object
												.name === node.init.callee.params[0].name
										);
									}
								);

								if (
									superDeclarator &&
									superDeclarator.type === "ExpressionStatement"
								)
									superDeclaratorCopy = Object.assign({}, superDeclarator);

								expression.body.body.map((statement) => {
									if (
										(superDeclarator && statement === superDeclarator) ||
										statement.type === "ReturnStatement" ||
										(superDeclaratorCopy &&
											superDeclaratorCopy.type === "ExpressionStatement" &&
											superDeclaratorCopy.expression.type ===
												"AssignmentExpression" &&
											superDeclaratorCopy.expression.left.type ===
												"Identifier" &&
											statement.type === "VariableDeclaration" &&
											statement.declarations[0] &&
											statement.declarations[0].id.type === "Identifier" &&
											statement.declarations[0].id.name ===
												superDeclaratorCopy.expression.left.name) ||
										(statement.type === "ExpressionStatement" &&
											statement.expression.type === "AssignmentExpression" &&
											statement.expression.right.type === "CallExpression" &&
											statement.expression.right.callee.type ===
												"MemberExpression" &&
											statement.expression.right.callee.property.type ===
												"Identifier" &&
											statement.expression.right.callee.property.name ===
												"bind")
									) {
										return Object.assign(statement, {
											type: "EmptyStatement",
										});
									}

									if (
										superDeclaratorCopy &&
										superDeclaratorCopy.type === "ExpressionStatement" &&
										superDeclaratorCopy.expression.type ===
											"AssignmentExpression" &&
										superDeclaratorCopy.expression.left.type === "Identifier" &&
										statement.type === "ExpressionStatement" &&
										statement.expression.type === "AssignmentExpression" &&
										statement.expression.left.type === "MemberExpression" &&
										statement.expression.left.object.type === "Identifier" &&
										statement.expression.left.object.name ===
											superDeclaratorCopy.expression.left.name
									) {
										return Object.assign(statement, {
											expression: {
												...statement.expression,
												left: {
													...statement.expression.left,
													object: {
														...statement.expression.left.object,
														type: "ThisExpression",
													},
												},
											},
										});
									}

									return statement;
								});

								return Object.assign(expression, {
									type: "MethodDefinition",
									key: {
										...expression.id,
										name: "constructor",
									},
									static: false,
									kind: "constructor",
									value: {
										...expression,
										type: "FunctionExpression",
										body: {
											...expression.body,
											body: [
												superDeclarator && {
													type: "ExpressionStatement",
													expression: {
														type: "CallExpression",
														callee: {
															type: "Super",
														},
														arguments: expression.params,
														optional: false,
													},
												},
												...expression.body.body,
											],
										},
									},
								});
							}

							return Object.assign(expression, {
								type: "MethodDefinition",
								key: expression.id,
								static: false,
								kind: "method",
								value: {
									...expression,
									type: "FunctionExpression",
								},
							});
						}
						case "VariableDeclaration": {
							var isMirrorProperty = false;

							expression.declarations.map((declarator) => {
								if (
									declarator.init &&
									declarator.init.type === "MemberExpression" &&
									declarator.init.object &&
									declarator.init.object.type === "Identifier" &&
									declarator.init.object.name === (node.id as Identifier).name
								) {
									isMirrorProperty = true;
									mirroredProperties.push(declarator.id as Identifier);

									return Object.assign(declarator, {
										type: "EmptyStatement",
									});
								}
							});

							return isMirrorProperty
								? Object.assign(expression, {
										type: "EmptyStatement",
								  })
								: expression;
						}
						case "ExpressionStatement": {
							if (
								expression.expression.type === "AssignmentExpression" &&
								expression.expression.left.type === "MemberExpression" &&
								expression.expression.left.object.type === "Identifier" &&
								(mirroredProperties.find(
									(prop) =>
										expression.expression.type === "AssignmentExpression" &&
										expression.expression.left.type === "MemberExpression" &&
										expression.expression.left.object.type === "Identifier" &&
										expression.expression.left.object.name === prop.name
								) ||
									(node.id.type === "Identifier" &&
										expression.expression.left.object.name === node.id.name)) &&
								expression.expression.right.type === "FunctionExpression"
							) {
								return Object.assign(expression, {
									type: "MethodDefinition",
									key: expression.expression.right.id,
									static: false,
									kind: "method",
									value: {
										...expression.expression.right,
										id: null,
									},
								});
							}

							return expression;
						}
						case "ReturnStatement": {
							if (
								node.id.type === "Identifier" &&
								expression.argument &&
								expression.argument.type === "Identifier" &&
								expression.argument.name === node.id.name
							) {
								return Object.assign(expression, {
									type: "EmptyStatement",
								});
							}

							return expression;
						}
						default: {
							return expression;
						}
					}
				});

				node.init.callee.body.body.forEach((expression) => {
					const mirroredSelfProperties: {
						identifier: Identifier;
						memberExpression: MemberExpression;
					}[] = [];

					switch (expression.type as string) {
						case "MethodDefinition": {
							(
								expression as unknown as MethodDefinition
							).value.body.body.forEach((embeddedExpression) => {
								if (
									embeddedExpression &&
									embeddedExpression.type === "VariableDeclaration"
								) {
									embeddedExpression.declarations.forEach((declarator) => {
										if (
											declarator.init &&
											declarator.init.type === "MemberExpression" &&
											declarator.init.object &&
											declarator.init.object.type === "ThisExpression"
										) {
											mirroredSelfProperties.push({
												identifier: declarator.id as Identifier,
												memberExpression: declarator.init as MemberExpression,
											});
										} else if (
											declarator.init &&
											declarator.init.type === "MemberExpression" &&
											declarator.init.object &&
											declarator.init.object.type === "Identifier" &&
											mirroredSelfProperties.find(
												(prop) =>
													declarator.init &&
													declarator.init.type === "MemberExpression" &&
													declarator.init.object &&
													declarator.init.object.type === "Identifier" &&
													declarator.init.object.name === prop.identifier.name
											)
										) {
											Object.assign(declarator, {
												init: {
													...declarator.init,
													object: mirroredSelfProperties.find(
														(prop) =>
															declarator.init &&
															declarator.init.type === "MemberExpression" &&
															declarator.init.object &&
															declarator.init.object.type === "Identifier" &&
															declarator.init.object.name ===
																prop.identifier.name
													)!.memberExpression,
												},
											});
										}
									});
								}
							});
						}
					}
				});

				Object.assign(parent, {
					...node,
					type: "ClassDeclaration",
					superClass: node.init.arguments[0],
					body: {
						...node.init.callee.body,
						type: "ClassBody",
					},
				});
			}
		},

		// @ts-ignore
		ExpressionStatement(node: ExpressionStatement, ancestors: Node[]) {
			if (
				node.expression.type === "AssignmentExpression" &&
				node.expression.right.type === "CallExpression" &&
				isJSXRuntime(node.expression.right.callee, customJSXRuntime)
			) {
				Object.assign(node, {
					expression: {
						...node.expression,
						right: recurseCallExpression(node.expression.right),
					},
				});
			}
		},

		// @ts-ignore
		FunctionDeclaration(_node: FunctionDeclaration, ancestors: Node[]) {
			var displayName = program.body[
				program.body.findIndex(
					(node) =>
						_node &&
						node.type === "ExpressionStatement" &&
						node.expression.type === "AssignmentExpression" &&
						node.expression.left.type === "MemberExpression" &&
						node.expression.left.object.type === "Identifier" &&
						node.expression.left.object.name === _node.id!.name &&
						node.expression.left.property.type === "Identifier" &&
						node.expression.left.property.name === "displayName"
				)
			]! as ExpressionStatement;

			if (
				displayName &&
				displayName.type === "ExpressionStatement" &&
				displayName.expression.type === "AssignmentExpression" &&
				displayName.expression.left.type === "MemberExpression" &&
				displayName.expression.left.object.type === "Identifier" &&
				displayName.expression.left.property.type === "Identifier" &&
				displayName.expression.right.type === "Literal"
			) {
				_node.id!.name = displayName.expression.right.value! as string;
				displayName.expression.left.object.name = displayName.expression.right
					.value! as string;
			}
		},

		// @ts-ignore
		CallExpression(_node: CallExpression, ancestors: Node[]) {
			const parent = ancestors[ancestors.length - 2];
			if (parent.type !== "ReturnStatement") return;

			Object.assign(parent, { argument: recurseCallExpression(_node) });
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

		// @ts-ignore
		UnaryExpression(node: UnaryExpression, ancestors: Node[]) {
			if (isBooleanOperator(node)) {
				Object.assign(node, {
					type: "Literal",
					value: Boolean(!(node.argument as Literal).value),
				});
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

function isBooleanOperator(node: UnaryExpression) {
	return (
		node.type === "UnaryExpression" &&
		node.operator === "!" &&
		node.argument.type === "Literal" &&
		typeof node.argument.value === "number"
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
