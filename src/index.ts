import * as acorn from "acorn";
import * as walk from "acorn-walk";
import acornJSX from "acorn-jsx";
import {
	outputFileSync as writeFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
} from "fs-extra";
import { globSync } from "glob";
import path from "path";
import {
	Program,
	CallExpression,
	MemberExpression,
	SequenceExpression,
	UnaryExpression,
	FunctionDeclaration,
	ExpressionStatement,
	Literal,
	VariableDeclarator,
	Node,
	Identifier,
	ImportDeclaration,
} from "estree";
import * as recast from "recast";
import * as prettier from "prettier";

import ClassParser from "./ClassParser";
import CallParser from "./CallParser";
import {
	isCustomJSXRuntime,
	parseComponentProps,
	isBooleanOperator,
	pushWithoutDuplicates,
} from "./utils";
import ImportParser from "./ImportParser";
import ExportParser from "./ExportParser";

const parser = acorn.Parser.extend(acornJSX());

if (!existsSync(path.join(process.cwd(), "input"))) {
	mkdirSync(path.join(process.cwd(), "input"));
}

if (!existsSync(path.join(process.cwd(), "output"))) {
	mkdirSync(path.join(process.cwd(), "output"));
}

const files = globSync(`input/**/*.js`).map((file) =>
	file.split("\\").slice(1).join("\\")
);

for (const file of files) {
	try {
		console.log(file);
		const filePath = path.join(process.cwd(), "input", file);
		const data = readFileSync(filePath, "utf-8");
		const ast = parser.parse(data, {
			sourceType: "module",
			ecmaVersion: "latest",
			preserveParens: true,
		});
		const parsedAst = parseModule(ast);

		writeFileSync(
			path.join(process.cwd(), "output", `${file}x`),
			prettier.format(recast.print(parsedAst).code, { parser: "babel" })
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

	const importParser = new ImportParser(program);
	const exportParser = new ExportParser(importParser);

	const temporaryImports: ImportDeclaration[] = [];

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

				if (component.type === "CallExpression") return;

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
			} else if (
				node.object &&
				node.object.type === "Identifier" &&
				node.object.name !== "exports" &&
				node.property.type === "Identifier" &&
				node.property.name === "default"
			) {
				Object.assign(node, node.object);
			} else if (
				importParser.importIdentifiers.find(
					(importId) =>
						node.object &&
						node.object.type === "Identifier" &&
						importId.original.name === node.object.name
				)
			) {
				const mappedImportId = importParser.importIdentifiers.find(
					(importId) =>
						node.object &&
						node.object.type === "Identifier" &&
						importId.original.name === node.object.name
				)! as { original: Identifier; new: Identifier };

				Object.assign(node, {
					object: mappedImportId.new,
				});
			}
		},

		// @ts-ignore
		VariableDeclarator(node: VariableDeclarator, ancestors: Node[]) {
			const parent = ancestors[ancestors.length - 2];
			if (parent.type !== "VariableDeclaration") return;

			const classParser = new ClassParser();

			if (ancestors.length === 3 && classParser.isClass(node)) {
				Object.assign(parent, classParser.parse(node, parent));
			}

			if (importParser.isImport(node)) {
				pushWithoutDuplicates(
					temporaryImports,
					...importParser.parse(node, parent)
				);
			}
		},

		// @ts-ignore
		ExpressionStatement(node: ExpressionStatement, ancestors: Node[]) {
			const parent = ancestors[ancestors.length - 2];

			const callParser = new CallParser(customJSXRuntime);

			if (
				node.expression.type === "AssignmentExpression" &&
				node.expression.right.type === "CallExpression" &&
				parent.type === "BlockStatement" &&
				callParser.isJSXRuntime(node.expression.right.callee)
			) {
				Object.assign(node, {
					expression: {
						...node.expression,
						right: callParser.recurse(node.expression.right),
					},
				});
			}

			if (exportParser.isExport(node)) {
				Object.assign(node, exportParser.parse(node, program));
			}
		},

		// @ts-ignore
		FunctionDeclaration(node: FunctionDeclaration, ancestors: Node[]) {
			var displayName = program.body[
				program.body.findIndex(
					(statement) =>
						node &&
						statement.type === "ExpressionStatement" &&
						statement.expression.type === "AssignmentExpression" &&
						statement.expression.left.type === "MemberExpression" &&
						statement.expression.left.object.type === "Identifier" &&
						statement.expression.left.object.name === node.id!.name &&
						statement.expression.left.property.type === "Identifier" &&
						statement.expression.left.property.name === "displayName"
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
				node.id!.name = displayName.expression.right.value! as string;
				displayName.expression.left.object.name = displayName.expression.right
					.value! as string;
			}
		},

		// @ts-ignore - recursive React.createElement parser
		CallExpression(node: CallExpression, ancestors: Node[]) {
			const parent = ancestors[ancestors.length - 2];
			if (parent.type !== "ReturnStatement") return;

			const callParser = new CallParser(customJSXRuntime);
			Object.assign(parent, callParser.parse(node, parent));
		},

		// @ts-ignore - replaces Babel artifacts like (0, React.createElement) with React.createElement
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

		// @ts-ignore - replaces !0 and !1 with true and false
		UnaryExpression(node: UnaryExpression, ancestors: Node[]) {
			if (isBooleanOperator(node)) {
				Object.assign(node, {
					type: "Literal",
					value: !!!(node.argument as Literal).value,
				});
			}
		},

		// @ts-ignore
		Identifier(node: Identifier, ancestors: Node[]) {
			if (
				importParser.importIdentifiers.find(
					(importId) => importId.original.name === node.name
				)
			) {
				const mappedImportId = importParser.importIdentifiers.find(
					(importId) => importId.original.name === node.name
				)! as { original: Identifier; new: Identifier };

				Object.assign(node, mappedImportId.new);
			}
		},
	});

	Object.assign(program, {
		body: [...temporaryImports, ...program.body],
	});

	return node;
}
