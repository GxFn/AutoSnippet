# AutoSnippet

A iOS module management tool. Use the command line to create an Xcode Snippet, generate a JSON file, and share it with other developers in the code repository.

## Installation

```bash
$ npm install -g autosnippet
```

## Options

Please use all the following commands in the current Xcode project file directory.

### init

Execute this command in the root directory of the Xcode project to create a workspace:

```bash
$ asd init
```

When creating a workspace, the Snippet configuration information of the sub-workspace will be collected to the current workspace.

### create

Command to create an Xcode Snippet, in the file directory marked with `// ACode` code:

```bash
$ asd c
```

Code like this:

```
// ACode
UIView *view = [[UIView alloc] init];
// ACode
```

### install

Add the shared Snippet to the Xcode environment:

```bash
$ asd i
```

Use code Snippet like this:

```
// view is code key entered when creating
@view 
```

### share

Share local Snippet:

```bash
$ asd s
```

### watch

In modular projects, recognize that Snippet automatically injects dependency header files:

```bash
$ asd w
```

#### Append header file

After the watch is turned on, if you want to append the header file, perform the following operations:

1. Down arrow to select the headerVersion of Snippet
2. Press the `Enter`
3. `Command + S` save file

Within 1 second, the header file is automatically added to the file header.

#### Browser view

After the watch is turned on, if you want to view more information about the module in the browser, perform the following operations:

1. Enter `@` and `module key`
2. Enter `#` and `ALink`
3. `Command + S` save file

Automatically jump to the browser to open the link configured during creation, and open the README.md file without a link.

Use ALink like this:

```
@view#ALink
```

## Other

### Shortcuts for placeholders

You can add a placeholder in your snippets too using following tag:

```
<#placeholder#>
```

E.g: the above placeholder can be written as:

```
<#view: UIView#>
```

Xcode detects <# and #> tokens and will make the text between them a placeholder. We can switch between multiple placeholders by pressing `Tab` key.

When there are multiple same placeholders, use `⌥⌘E` to select multiple placeholders continuously:

1. Select a placeholder
2. `⌥⌘E` selects the next placeholder, `⌥⇧⌘E` selects the previous placeholder
3. Enter the modified content, all selected placeholders will be modified

Thanks.