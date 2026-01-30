(*
  用于 asd ui：在 macOS 上优先复用已打开的同 URL 标签（如 http://localhost:3000），
  找不到则新建标签。基于 create-react-app 的 openChrome.applescript 逻辑简化。
  用法: osascript openChrome.applescript "URL" ["浏览器名称"]
*)
property targetTab: null
property targetTabIndex: -1
property targetWindow: null
property theProgram: "Google Chrome"

on run argv
	set theURL to item 1 of argv
	if (count of argv) > 1 then
		set theProgram to item 2 of argv
	end if

	using terms from application "Google Chrome"
		tell application theProgram
			if (count every window) = 0 then
				make new window
			end if

			-- 1: 查找已打开该 URL 的标签，若有则激活并聚焦（不强制刷新）
			set found to my lookupTabWithUrl(theURL)
			if found then
				set targetWindow's active tab index to targetTabIndex
				tell targetWindow to activate
				set index of targetWindow to 1
				return
			end if

			-- 2: 未找到则新开标签
			tell window 1
				activate
				make new tab with properties {URL:theURL}
			end tell
		end tell
	end using terms from
end run

on lookupTabWithUrl(lookupUrl)
	using terms from application "Google Chrome"
		tell application theProgram
			set found to false
			set theTabIndex to -1
			repeat with theWindow in every window
				set theTabIndex to 0
				repeat with theTab in every tab of theWindow
					set theTabIndex to theTabIndex + 1
					if (theTab's URL as string) contains lookupUrl then
						set targetTab to theTab
						set targetTabIndex to theTabIndex
						set targetWindow to theWindow
						set found to true
						exit repeat
					end if
				end repeat
				if found then
					exit repeat
				end if
			end repeat
		end tell
	end using terms from
	return found
end lookupTabWithUrl
