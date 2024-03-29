import {
	Identifier,
	MemberExpression,
	VariableDeclarator,
	VariableDeclaration,
	ClassDeclaration,
	MethodDefinition,
	ObjectExpression,
	Property,
	FunctionExpression,
} from "estree";

class ClassParser {
	mirroredProperties: Identifier[];
	mirroredSelfProperties: {
		identifier: Identifier;
		memberExpression: MemberExpression;
	}[];
	getters: MethodDefinition[];

	constructor() {
		this.mirroredProperties = [];
		this.mirroredSelfProperties = [];
		this.getters = [];
	}

	isClass(node: VariableDeclarator): boolean {
		return !!(
			node.id &&
			node.id.type === "Identifier" &&
			node.init &&
			node.init.type === "CallExpression" &&
			node.init.callee &&
			node.init.callee.type === "FunctionExpression" &&
			node.init.callee.params.length === node.init.arguments.length &&
			node.init.callee.body.body[0].type === "ExpressionStatement"
		);
	}

	parse(
		node: VariableDeclarator,
		parent: VariableDeclaration
	): ClassDeclaration {
		if (
			node.id &&
			node.id.type === "Identifier" &&
			node.init &&
			node.init.type === "CallExpression" &&
			node.init.arguments[0] &&
			node.init.arguments[0].type === "MemberExpression" &&
			node.init.callee &&
			node.init.callee.type === "FunctionExpression" &&
			node.init.callee.params.length === node.init.arguments.length &&
			node.init.callee.body.body[0].type === "ExpressionStatement"
		) {
			node.init.callee.body.body.shift(); // inheritsLoose

			return {
				...node,
				id: node.id as unknown as Identifier,
				type: "ClassDeclaration",
				superClass: node.init.arguments[0] as unknown as MemberExpression,
				body: {
					...node.init.callee.body,
					type: "ClassBody",
					body: [
						...(node.init.callee.body.body.map((expression) => {
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
														...expression.body.body.map((statement) => {
															if (
																(superDeclarator &&
																	statement === superDeclarator) ||
																statement.type === "ReturnStatement" ||
																(superDeclaratorCopy &&
																	superDeclaratorCopy.type ===
																		"ExpressionStatement" &&
																	superDeclaratorCopy.expression.type ===
																		"AssignmentExpression" &&
																	superDeclaratorCopy.expression.left.type ===
																		"Identifier" &&
																	statement.type === "VariableDeclaration" &&
																	statement.declarations[0] &&
																	statement.declarations[0].id.type ===
																		"Identifier" &&
																	statement.declarations[0].id.name ===
																		superDeclaratorCopy.expression.left.name) ||
																(statement.type === "ExpressionStatement" &&
																	statement.expression.type ===
																		"AssignmentExpression" &&
																	statement.expression.right.type ===
																		"CallExpression" &&
																	statement.expression.right.callee.type ===
																		"MemberExpression" &&
																	statement.expression.right.callee.property
																		.type === "Identifier" &&
																	statement.expression.right.callee.property
																		.name === "bind")
															) {
																return Object.assign(statement, {
																	type: "EmptyStatement",
																});
															}

															if (
																superDeclaratorCopy &&
																superDeclaratorCopy.type ===
																	"ExpressionStatement" &&
																superDeclaratorCopy.expression.type ===
																	"AssignmentExpression" &&
																superDeclaratorCopy.expression.left.type ===
																	"Identifier" &&
																statement.type === "ExpressionStatement" &&
																statement.expression.type ===
																	"AssignmentExpression" &&
																statement.expression.left.type ===
																	"MemberExpression" &&
																statement.expression.left.object.type ===
																	"Identifier" &&
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
														}),
													],
												},
											},
										});
									}

									expression.body.body.map((embeddedExpression) => {
										if (
											embeddedExpression &&
											embeddedExpression.type === "VariableDeclaration"
										) {
											const declarations = embeddedExpression.declarations
												.map((declarator) => {
													if (
														declarator.init &&
														declarator.init.type === "MemberExpression" &&
														declarator.init.object &&
														declarator.init.object.type === "ThisExpression"
													) {
														this.mirroredSelfProperties.push({
															identifier: declarator.id as Identifier,
															memberExpression:
																declarator.init as MemberExpression,
														});
													} else if (
														declarator.init &&
														declarator.init.type === "MemberExpression" &&
														declarator.init.object &&
														declarator.init.object.type === "Identifier" &&
														declarator.init.object.name ===
															(node.id as Identifier).name
													) {
														this.mirroredProperties.push(
															declarator.id as Identifier
														);

														return Object.assign(declarator, {
															type: "EmptyStatement",
														});
													} else if (
														declarator.init &&
														declarator.init.type === "MemberExpression" &&
														declarator.init.object &&
														declarator.init.object.type === "Identifier" &&
														this.mirroredSelfProperties.find(
															(prop) =>
																declarator.init &&
																declarator.init.type === "MemberExpression" &&
																declarator.init.object &&
																declarator.init.object.type === "Identifier" &&
																declarator.init.object.name ===
																	prop.identifier.name
														)
													) {
														return Object.assign(declarator, {
															init: {
																...declarator.init,
																object: this.mirroredSelfProperties.find(
																	(prop) =>
																		declarator.init &&
																		declarator.init.type ===
																			"MemberExpression" &&
																		declarator.init.object &&
																		declarator.init.object.type ===
																			"Identifier" &&
																		declarator.init.object.name ===
																			prop.identifier.name
																)!.memberExpression,
															},
														});
													}

													return declarator;
												})
												.filter((declaration) => declaration);

											return Object.assign(
												embeddedExpression,
												declarations.length >= 1
													? {
															declarations,
													  }
													: {
															type: "EmptyStatment",
													  }
											);
										}

										return embeddedExpression;
									});

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
									const declarations = expression.declarations
										.map((declarator) => {
											if (
												declarator.init &&
												declarator.init.type === "MemberExpression" &&
												declarator.init.object &&
												declarator.init.object.type === "ThisExpression"
											) {
												this.mirroredSelfProperties.push({
													identifier: declarator.id as Identifier,
													memberExpression: declarator.init as MemberExpression,
												});
											} else if (
												declarator.init &&
												declarator.init.type === "MemberExpression" &&
												declarator.init.object &&
												declarator.init.object.type === "Identifier" &&
												declarator.init.object.name ===
													(node.id as Identifier).name
											) {
												this.mirroredProperties.push(
													declarator.id as Identifier
												);

												return null;
											} else if (
												declarator.init &&
												declarator.init.type === "MemberExpression" &&
												declarator.init.object &&
												declarator.init.object.type === "Identifier" &&
												this.mirroredSelfProperties.find(
													(prop) =>
														declarator.init &&
														declarator.init.type === "MemberExpression" &&
														declarator.init.object &&
														declarator.init.object.type === "Identifier" &&
														declarator.init.object.name === prop.identifier.name
												)
											) {
												return Object.assign(declarator, {
													init: {
														...declarator.init,
														object: this.mirroredSelfProperties.find(
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

											return declarator;
										})
										.filter((declaration) => declaration);

									return declarations.length >= 1
										? Object.assign(expression, {
												declarations,
										  })
										: {
												type: "EmptyStatement",
										  };
								}
								case "ExpressionStatement": {
									if (
										expression.expression.type === "AssignmentExpression" &&
										expression.expression.left.type === "MemberExpression" &&
										expression.expression.left.object.type === "Identifier" &&
										(this.mirroredProperties.find(
											(prop) =>
												expression.expression.type === "AssignmentExpression" &&
												expression.expression.left.type ===
													"MemberExpression" &&
												expression.expression.left.object.type ===
													"Identifier" &&
												expression.expression.left.object.name === prop.name
										) ||
											(node.id.type === "Identifier" &&
												expression.expression.left.object.name ===
													node.id.name)) &&
										expression.expression.right.type === "FunctionExpression"
									) {
										return Object.assign(expression, {
											type: "MethodDefinition",
											key: expression.expression.left.property,
											static: false,
											kind: "method",
											value: {
												...expression.expression.right,
												id: null,
											},
										});
									}

									if (
										expression.expression.type === "AssignmentExpression" &&
										expression.expression.left.type === "MemberExpression" &&
										expression.expression.left.object.type === "Identifier" &&
										(this.mirroredProperties.find(
											(prop) =>
												expression.expression.type === "AssignmentExpression" &&
												expression.expression.left.type ===
													"MemberExpression" &&
												expression.expression.left.object.type ===
													"Identifier" &&
												expression.expression.left.object.name === prop.name
										) ||
											(node.id.type === "Identifier" &&
												expression.expression.left.object.name ===
													node.id.name)) &&
										expression.expression.right.type === "CallExpression"
									) {
										return Object.assign(expression, {
											type: "MethodDefinition",
											key: expression.expression.left.property,
											static: false,
											kind: "method",
											value: {
												type: "FunctionExpression",
												id: null,
												expression: false,
												generator: false,
												async: false,
												params: [],
												body: {
													type: "BlockStatement",
													body: [
														{
															type: "ExpressionStatement",
															expression: {
																...expression.expression.right,
																callee: {
																	...expression.expression.right.callee,
																	type: "ArrowFunctionExpression",
																},
															},
														},
													],
												},
											},
										});
									}

									if (
										expression.expression.type === "CallExpression" &&
										expression.expression.arguments[0] &&
										expression.expression.arguments[0].type === "Identifier" &&
										node.id.type === "Identifier" &&
										expression.expression.arguments[0].name === node.id.name &&
										expression.expression.arguments[1] &&
										expression.expression.arguments[1].type ===
											"ArrayExpression" &&
										expression.expression.arguments[1].elements.every(
											(element) =>
												element &&
												element.type === "ObjectExpression" &&
												element.properties.every(
													(property) =>
														(property &&
															property.type === "Property" &&
															property.key.type === "Identifier" &&
															property.key.name === "key") ||
														"get"
												)
										)
									) {
										(
											expression.expression.arguments[1]
												.elements as ObjectExpression[]
										).forEach((element) => {
											this.getters.push({
												type: "MethodDefinition",
												static: false,
												computed: false,
												key: (element.properties[0] as Property).key,
												kind: "get",
												value: (element.properties[1] as Property)
													.value as FunctionExpression,
											});
										});

										return Object.assign(expression, {
											type: "EmptyStatement",
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
						}) as unknown as MethodDefinition[]),
						...this.getters,
					],
				},
			};
		}

		return parent as unknown as ClassDeclaration;
	}
}

export default ClassParser;
