#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const CMD_PATH = process.cwd();
const findPath = require('./findPath.js');

async function initSpec() {
	const filePath = path.join(CMD_PATH, '/AutoSnippet.boxspec.json');
	let idsArray = [];
	let specObj = {
		list: []
	};

	try {
		await fs.promises.access(filePath);
	} catch (error) {
		const content = JSON.stringify(specObj, null, 4);
		fs.writeFileSync(filePath, content, 'utf8');
	}

	const specSlashIndex = filePath.lastIndexOf('/');
	const specFilePath = filePath.substring(0, specSlashIndex + 1);

	const array = await findPath.findSubASSpecPath(CMD_PATH);

	for (let i = 0; i < array.length; i++) {
		const filename = array[i];

		const slashIndex = filename.lastIndexOf('/');
		let thePath = filename.substring(0, slashIndex + 1);
		if (filename === filePath) {
			thePath = '';
		} else {
			thePath = thePath.replace(specFilePath, '');
		}

		try {
			// 读取AutoSnippet的占位配置
			const data = fs.readFileSync(filename, 'utf8');
            const config = JSON.parse(data);
			if (config && config.list) {

                const arr = config.list.filter(function (item, index, array) {
                    for (let i = 0; i < idsArray.length; i++) {
                        if (item['{identifier}'] === idsArray[i]) {
                            return false;
                        }
                    }
                    idsArray.push(item['{identifier}']);
					// 头文件相对路径需要补齐
					if (item['{specHeadPath}']) {
						item['{specHeadPath}'] = thePath + item['{specHeadPath}'];
					}
                    return true;
                });
                specObj.list = specObj.list.concat(arr);
			}
		} catch (err) {
			console.error(err);
		}
	}

    try {
        const content = JSON.stringify(specObj, null, 4);
        if (content) {
            fs.writeFileSync(filePath, content, 'utf8');
        }
    } catch (err) {
        console.error(err);
    }
}

exports.initSpec = initSpec;