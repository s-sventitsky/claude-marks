# Main-screen behaviour: require fullscreen or degrade?

Type: grilling
Status: resolved

## Question

Clicking inline markers and jumping the transcript both work only in the fullscreen terminal. On the main screen (`CLAUDE_CODE_NO_FLICKER=0`, tmux by default) the transcript is native scrollback, so there are no clicks and no jump. Should the mod require fullscreen (and say so), or degrade on the main screen? A degraded mode might keep the tree and band read-only, copy an excerpt to search for, or something else. See [Mod API: can we mark transcript rows and jump to them?](01-mod-api-navigation.md).

## Comments

- 2026-10-11, suggestion from the user: a keyboard menu panel like `/usage` instead of mouse clicks. Checked against the API:
  - A pane opened with `focus` (dialog style) works by keyboard on both screens. Tab and the arrows move between its buttons, Enter or a `hotkey` presses one, and Esc closes it.
  - A keyboard press counts as the person's own action, so it can trigger `$.ui.scroll`.
  - So a keyboard menu solves **clicking** everywhere, and in fullscreen it also solves **jumping**. On the main screen it still can't scroll native scrollback. The workaround there is to show the chosen exchange **inside the pane** (a reader view, using text from `$.session.messages()`) instead of scrolling the conversation.
- 2026-10-11, direction agreed with the user: the user works in fullscreen in VS Code's integrated terminal (see map Notes), so this ticket shrinks to a **fallback** decision. Leading option: the same keyboard menu on both screens, where Enter opens the portal (reader view) on the main screen instead of jumping. Still to settle when the ticket is worked: whether that is enough, and how the band and inline markers behave there.

## Answer

2026-10-11, grilled with the user. **Degrade, don't require fullscreen.** The mod reads `isFullscreen` (`command.run`'s `presentation`, or `viewport` on any drawing). The terminal fixes it per session, so the mode never switches mid-session. On the main screen:

- **Menu:** the same keyboard menu as fullscreen (a focused pane, inline above the prompt here). **Enter opens the portal** instead of jumping.
- **Footer hint:** on the main screen only, one footer line in the menu says that fullscreen enables jumping. No toast, nothing in the band. The UI prototype sets the wording.
- **Band:** shows the thread of the **latest exchange** (there is no `onScreen` to say what is visible), plus the usual hint.
- **Inline markers:** **none**. Printed scrollback is frozen, and labels arrive after `turn.complete`, after the row has printed. They would be missing or stale most of the time.
- **Follows from the above:** focus mode is fullscreen-only (scrollback rows can't fold). There is no glyph-click bookmarking, but `/mark` and the menu work.

Not decided here: the portal's reach in long conversations (`$.session.messages()` returns the newest 4096 entries). That stays in the map's **Long conversations** fog.
