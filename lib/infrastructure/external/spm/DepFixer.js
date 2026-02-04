/**
 * DepFixer - 仅负责修补 Package.swift
 */

const fs = require('fs');
const path = require('path');

class DepFixer {
  patchPackageSwiftAddTargetDependency(packageSwiftPath, fromTarget, toTarget, options = {}) {
    try {
      const src = fs.readFileSync(packageSwiftPath, 'utf8');
      if (!src) return { ok: false, error: 'File is empty' };

      const targetSpec = this._buildTargetDependencySpec({ fromTarget, toTarget, options, packageSwiftPath, src });
      if (!targetSpec) {
        return { ok: false, error: 'Failed to resolve target dependency spec' };
      }

      let patchedSrc = this._ensurePackageDependency(src, targetSpec.packageDep);

      const targetRegex = new RegExp(
        String.raw`\.target\s*\(\s*name:\s*"${fromTarget}"[\s\S]*?\)`,
        'm'
      );

      const match = patchedSrc.match(targetRegex);
      if (!match) {
        return { ok: false, error: `Target "${fromTarget}" not found` };
      }

      const depToken = targetSpec.dependencyToken;
      const alreadyExists = this._hasTargetDependency(match[0], depToken, targetSpec.toTargetLiteral);
      if (alreadyExists) {
        return { ok: true, changed: false };
      }

      const updatedTarget = this._injectTargetDependency(match[0], fromTarget, depToken);
      if (!updatedTarget) {
        return { ok: false, error: 'Failed to update target dependency list' };
      }

      patchedSrc = patchedSrc.replace(targetRegex, updatedTarget);

      fs.writeFileSync(packageSwiftPath, patchedSrc, 'utf8');
      return {
        ok: true,
        changed: true,
        changes: [{ type: 'targetDependency', fromTarget, toTarget, file: packageSwiftPath }]
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  _buildTargetDependencySpec({ fromTarget, toTarget, options, packageSwiftPath, src }) {
    const spmmap = options && options.spmmap ? options.spmmap : null;
    const fromPackageName = options && options.fromPackageName ? options.fromPackageName : null;
    const toPackageName = options && options.toPackageName ? options.toPackageName : null;

    let isSamePackage = !!fromPackageName && !!toPackageName && fromPackageName === toPackageName;
    if (!toPackageName && fromPackageName) isSamePackage = true;

    let dependencyToken = `"${toTarget}"`;
    if (!isSamePackage && toPackageName) {
      dependencyToken = `.product(name: "${toTarget}", package: "${toPackageName}")`;
    }

    const packageDep = !isSamePackage && toPackageName
      ? this._buildPackageDependencyRef({ spmmap, fromPackageName, toPackageName, packageSwiftPath })
      : null;

    return {
      dependencyToken,
      packageDep,
      toTargetLiteral: `"${toTarget}"`
    };
  }

  _buildPackageDependencyRef({ spmmap, fromPackageName, toPackageName, packageSwiftPath }) {
    try {
      if (!spmmap || !toPackageName) return null;
      const pkgRef = spmmap.packages && spmmap.packages[toPackageName] ? spmmap.packages[toPackageName] : null;
      if (pkgRef && pkgRef.kind === 'url') {
        const from = pkgRef.from || '0.0.0';
        return { kind: 'url', url: pkgRef.url, from };
      }

      const graph = spmmap.graph || {};
      const pathDecls = graph.pathDecls || {};
      if (fromPackageName && toPackageName && pathDecls[fromPackageName] && pathDecls[fromPackageName][toPackageName]) {
        return { kind: 'path', path: pathDecls[fromPackageName][toPackageName] };
      }

      const packages = graph.packages || {};
      const fromPkg = fromPackageName ? packages[fromPackageName] : null;
      const toPkg = packages[toPackageName];
      if (fromPkg && toPkg && fromPkg.packageDir && toPkg.packageDir && options.projectRoot) {
        const baseDir = path.dirname(packageSwiftPath);
        const targetDir = path.resolve(options.projectRoot, toPkg.packageDir);
        const rel = path.relative(baseDir, targetDir).replace(/\\/g, '/');
        const normalized = rel.startsWith('.') ? rel : `./${rel}`;
        return { kind: 'path', path: normalized };
      }

      return null;
    } catch {
      return null;
    }
  }

  _ensurePackageDependency(src, packageDep) {
    if (!packageDep) return src;
    const depSectionRegex = /dependencies:\s*\[([\s\S]*?)\]/m;
    const hasSection = depSectionRegex.test(src);
    const depLine = packageDep.kind === 'url'
      ? `.package(url: "${packageDep.url}", from: "${packageDep.from}")`
      : `.package(path: "${packageDep.path}")`;

    if (src.includes(depLine)) return src;

    if (hasSection) {
      return src.replace(depSectionRegex, (m, inner) => {
        const trimmed = inner.trim();
        const next = trimmed ? `${trimmed},\n        ${depLine}` : `\n        ${depLine}\n    `;
        return `dependencies: [${next}]`;
      });
    }

    return src.replace(/products:\s*\[/m, (m) => {
      return `dependencies: [\n        ${depLine}\n    ],\n    ${m}`;
    });
  }

  _hasTargetDependency(targetBlock, depToken, depLiteral) {
    if (!targetBlock) return false;
    if (depToken && targetBlock.includes(depToken)) return true;
    if (depLiteral && targetBlock.includes(depLiteral)) return true;
    return false;
  }

  _injectTargetDependency(targetBlock, fromTarget, depToken) {
    if (!targetBlock || !depToken) return null;

    const depsRegex = /dependencies:\s*\[([\s\S]*?)\]/m;
    if (depsRegex.test(targetBlock)) {
      return targetBlock.replace(depsRegex, (m, inner) => {
        const trimmed = inner.trim();
        const next = trimmed ? `${trimmed},\n                ${depToken}` : `\n                ${depToken}\n            `;
        return `dependencies: [${next}]`;
      });
    }

    const nameRegex = new RegExp(`name:\\s*\"${fromTarget}\"`);
    if (nameRegex.test(targetBlock)) {
      return targetBlock.replace(nameRegex, (m) => {
        return `${m},\n            dependencies: [\n                ${depToken}\n            ]`;
      });
    }

    return null;
  }
}

module.exports = DepFixer;
