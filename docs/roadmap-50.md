# Fifty additions — and sixty more

Built in batches, each with tests, each in its own commit. A box is ticked only
when the feature works and its tests pass. Anything not ticked says why.

Nothing here weakens a safety default: self-editing and computer access stay
opt-in, and every write and command still waits for approval.

## A. Security and operations
- [x] 1. Login rate limiting — lock out after repeated wrong passwords
- [x] 2. Security headers — nosniff, frame protection, referrer and permissions policy
- [x] 3. Audit log — logins, approvals, self-edit apply/undo, backups, restores
- [x] 4. `/api/health` — for uptime monitors and container health checks
- [x] 5. CI workflow — type check, tests and build on every push and pull request
- [x] 6. Dockerfile and compose file — run JARVIS in a container (compose syntax-checked; the image itself could not be built here, no Docker daemon)
- [x] 7. Settings export and import — move your setup between browsers (keys excluded)

## B. Chats
- [x] 8. Sidebar grouped by date — Today, Yesterday, Previous 7 days, Older
- [x] 9. Chat tags, with a filter
- [x] 10. Archive and unarchive chats
- [x] 11. Trash — deleted chats are recoverable for 30 days
- [x] 12. Branch a chat from any message
- [x] 13. Duplicate a chat
- [x] 14. Per-chat persona override
- [x] 15. Restore from a backup zip, inside the app
- [x] 16. Export a chat as JSON as well as Markdown
- [x] 17. Search operators — `tag:`, `is:pinned`, `is:archived`

## C. Messages and composer
- [x] 18. Message timestamps
- [x] 19. Response stats — time taken and tokens per second
- [x] 20. Star messages, with a Saved view across chats
- [x] 21. Collapse long messages
- [x] 22. Copy a table as CSV
- [x] 23. Code blocks: download as a file, wrap toggle
- [x] 24. Draft text kept per chat
- [x] 25. Up-arrow recalls your previous message
- [x] 26. Slash commands — `/new`, `/pin`, `/export`, `/summarize` …
- [x] 27. Saved prompts library
- [x] 28. Read a reply aloud, from any message

## D. Appearance and accessibility
- [x] 29. Light, dark or system theme
- [x] 30. Text size and density
- [x] 31. Keyboard shortcuts dialog (`?`)
- [x] 32. Resizable sidebar
- [x] 33. Accessibility pass — focus rings, skip link, reduced motion, landmarks
- [x] 34. Installable app — manifest and icons
- [x] 35. Print stylesheet for chats
- [x] 36. Offline banner

## E. Models and memory
- [x] 37. Persona presets
- [x] 38. Context meter — how full the model's window is
- [x] 39. Favourite models, starred in the picker
- [x] 40. Regenerate a reply with a different model
- [x] 41. Memory export and import
- [x] 42. Memory search and tag filter
- [x] 43. Unit conversion in `calculate`, at no extra tool cost

## F. Everything else
- [x] 44. Scheduled-task templates (morning briefing and others)
- [x] 45. Welcome screen with recent chats and quick actions
- [x] 46. Gallery: copy a picture's prompt, see what it was edited from
- [x] 47. Sandbox: view exactly what each past apply changed
- [x] 48. Usage export as CSV
- [x] 49. Automatic daily backups, keeping the last seven
- [x] 50. Chat statistics — messages, words, tools used, per day

## G. Emotion and initiative
JARVIS speaking first, within limits you set. Every item here is opt-out, gentle by default, and never acts for you: a card's buttons only fill the message box, move you somewhere, or save a note when pressed. The mood is a summary of the session, not a claim of feeling, and tone reading is a heuristic, not a safety system.

- [x] 51. A mood dot — how the session is going, from ratings, thanks and failures
- [x] 52. Suggestion cards — long chat, failing provider, break, late night, waiting approval, welcome back
- [x] 53. Interruption controls — level, master switch, quiet hours, per-kind switches, "stop suggesting this", learned mutes, opt-in desktop and spoken delivery
- [x] 54. A focus timer — hold everything back for a while
- [x] 55. An inbox — held suggestions and what the server said, with a badge
- [x] 56. Scheduled answers and failed backups reach you, as a card and in the inbox
- [x] 57. Matching your tone — direct for frustrated, short for rushed, gentle for low
- [x] 58. Follow-up buttons under replies
- [x] 59. "Remember that?" — offers to save a lasting fact, only on a press
- [x] 60. 👍 / 👎 on replies, counted under Usage

## H. Reading and navigating chats
- [x] 61. Find in this chat — every match marked, next and previous
- [x] 62. Outline: your questions as a jump list
- [x] 63. Alt+↑ / Alt+↓ between your messages
- [x] 64. Quote a message into your next one
- [x] 65. Copy a reply as plain text
- [x] 66. Reading time and word count on long replies
- [x] 67. Select several chats to archive, tag or trash together
- [x] 68. Download a chat as a self-contained web page
- [x] 69. Import a chat from a JSON export
- [x] 70. Export every chat as a zip of Markdown files

## I. Composing
- [x] 71. Word, character and token count in the message box
- [x] 72. `/model` — switch model by name
- [x] 73. `/title` — rename the chat
- [x] 74. `/tag` — add and remove tags
- [x] 75. `/undo` — take back your last message and its replies
- [x] 76. Send with Enter or Ctrl/⌘+Enter
- [x] 77. Spellcheck on or off
- [x] 78. Saved prompts with `{{blanks}}` that ask before they fill
- [x] 79. Search what you've sent (Ctrl/⌘+R)
- [x] 80. Reply-style presets — Precise, Balanced, Creative
