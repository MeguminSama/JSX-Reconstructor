import {
	Program,
	VariableDeclaration,
	ExpressionStatement,
	ExportDefaultDeclaration,
	ExportNamedDeclaration,
	AssignmentExpression,
	Identifier,
	MemberExpression,
} from "estree";

import ImportParser from "./ImportParser";

class ExportParser {
	importParser: ImportParser;
	program: Program;

	constructor(importParser: ImportParser) {
		this.importParser = importParser;
		this.program = importParser.program;
	}

	isExport(node: ExpressionStatement): boolean {
		return !!(
			node.type === "ExpressionStatement" &&
			node.expression.type === "AssignmentExpression" &&
			node.expression.left.type === "MemberExpression" &&
			node.expression.left.object.type === "Identifier" &&
			node.expression.left.object.name === "exports" &&
			node.expression.right.type === "Identifier"
		);
	}

	findExportDeclaration(name: string): VariableDeclaration | null | undefined {
		return this.program.body.find(
			(node) =>
				node.type === "VariableDeclaration" &&
				node.declarations.find(
					(declarator) =>
						declarator.id.type === "Identifier" && declarator.id.name === name
				)
		)! as VariableDeclaration;
	}

	parse(
		node: ExpressionStatement,
		parent: Program
	): ExportDefaultDeclaration | ExportNamedDeclaration {
		if (
			node.type === "ExpressionStatement" &&
			node.expression.type === "AssignmentExpression" &&
			node.expression.left.type === "MemberExpression" &&
			node.expression.left.object.type === "Identifier" &&
			node.expression.left.object.name === "exports" &&
			node.expression.left.property.type === "Identifier" &&
			node.expression.right.type === "Identifier"
		) {
			var exportDeclaration = this.findExportDeclaration(
				node.expression.right.name
			);

			if (exportDeclaration) {
				var exportDefinition = exportDeclaration.declarations.find(
					(declarator) =>
						declarator.id.type === "Identifier" &&
						declarator.id.name ===
							((node.expression as AssignmentExpression).right as Identifier)
								.name
				)!.init!;

				if (!exportDefinition) return node as unknown as ExportNamedDeclaration;

				if (node.expression.left.property.name === "default") {
					parent.body[
						parent.body.findIndex(
							(declaration) => declaration === exportDeclaration
						)
					] = null as any;

					parent.body = parent.body.filter((declaration) => declaration);

					if (
						this.importParser.importIdentifiers.find(
							(importId) =>
								exportDefinition.type === "MemberExpression" &&
								exportDefinition.object &&
								exportDefinition.object.type === "Identifier" &&
								importId.original.name === exportDefinition.object.name
						)
					) {
						const mappedImportId = this.importParser.importIdentifiers.find(
							(importId) =>
								exportDefinition.type === "MemberExpression" &&
								exportDefinition.object &&
								exportDefinition.object.type === "Identifier" &&
								importId.original.name === exportDefinition.object.name
						)! as { original: Identifier; new: Identifier };

						Object.assign(exportDefinition, {
							object: mappedImportId.new,
						});
					}

					return {
						type: "ExportDefaultDeclaration",
						declaration: exportDefinition!,
					};
				} else {
					parent.body[
						parent.body.findIndex(
							(declaration) => declaration === exportDeclaration
						)
					] = null as any;

					parent.body = parent.body.filter((declaration) => declaration);

					if (
						this.importParser.importIdentifiers.find(
							(importId) =>
								exportDefinition.type === "MemberExpression" &&
								exportDefinition.object &&
								exportDefinition.object.type === "Identifier" &&
								importId.original.name === exportDefinition.object.name
						)
					) {
						const mappedImportId = this.importParser.importIdentifiers.find(
							(importId) =>
								exportDefinition.type === "MemberExpression" &&
								exportDefinition.object &&
								exportDefinition.object.type === "Identifier" &&
								importId.original.name === exportDefinition.object.name
						)! as { original: Identifier; new: Identifier };

						Object.assign(exportDefinition, {
							object: mappedImportId.new,
						});
					}

					return {
						type: "ExportNamedDeclaration",
						declaration: {
							type: "VariableDeclaration",
							declarations: [
								{
									type: "VariableDeclarator",
									id: node.expression.left.property! as Identifier,
									init: exportDefinition!,
								},
							],
							kind: "const",
						},
						specifiers: [],
					};
				}
			}
		}

		return node as unknown as ExportNamedDeclaration;
	}
}

export default ExportParser;
