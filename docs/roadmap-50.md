# Fifty additions

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
- [ ] 8. Sidebar grouped by date — Today, Yesterday, Previous 7 days, Older
- [ ] 9. Chat tags, with a filter
- [ ] 10. Archive and unarchive chats
- [ ] 11. Trash — deleted chats are recoverable for 30 days
- [ ] 12. Branch a chat from any message
- [ ] 13. Duplicate a chat
- [ ] 14. Per-chat persona override
- [ ] 15. Restore from a backup zip, inside the app
- [ ] 16. Export a chat as JSON as well as Markdown
- [ ] 17. Search operators — `tag:`, `is:pinned`, `is:archived`

## C. Messages and composer
- [ ] 18. Message timestamps
- [ ] 19. Response stats — time taken and tokens per second
- [ ] 20. Star messages, with a Saved view across chats
- [ ] 21. Collapse long messages
- [ ] 22. Copy a table as CSV
- [ ] 23. Code blocks: download as a file, wrap toggle
- [ ] 24. Draft text kept per chat
- [ ] 25. Up-arrow recalls your previous message
- [ ] 26. Slash commands — `/new`, `/pin`, `/export`, `/summarize` …
- [ ] 27. Saved prompts library
- [ ] 28. Read a reply aloud, from any message

## D. Appearance and accessibility
- [ ] 29. Light, dark or system theme
- [ ] 30. Text size and density
- [ ] 31. Keyboard shortcuts dialog (`?`)
- [ ] 32. Resizable sidebar
- [ ] 33. Accessibility pass — focus rings, skip link, reduced motion, landmarks
- [ ] 34. Installable app — manifest and icons
- [ ] 35. Print stylesheet for chats
- [ ] 36. Offline banner

## E. Models and memory
- [ ] 37. Persona presets
- [ ] 38. Context meter — how full the model's window is
- [ ] 39. Favourite models, starred in the picker
- [ ] 40. Regenerate a reply with a different model
- [ ] 41. Memory export and import
- [ ] 42. Memory search and tag filter
- [ ] 43. Unit conversion in `calculate`, at no extra tool cost

## F. Everything else
- [ ] 44. Scheduled-task templates (morning briefing and others)
- [ ] 45. Welcome screen with recent chats and quick actions
- [ ] 46. Gallery: copy a picture's prompt, see what it was edited from
- [ ] 47. Sandbox: view exactly what each past apply changed
- [ ] 48. Usage export as CSV
- [ ] 49. Automatic daily backups, keeping the last seven
- [ ] 50. Chat statistics — messages, words, tools used, per day
