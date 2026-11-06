# Critique rubric

Eight criteria, each 0 to 5, 40 in all. **32 passes.** The critic judges screenshots of the rendered page, never the source, with AgentOS's rendered audit as fact.

| Criterion | What a 5 looks like |
|---|---|
| A real idea | The hero rests on one idea specific to this client. Move it to a competitor and it stops making sense. Distinct and suitable: the client could proudly show it to their own clients. |
| Commits to its assignment | The direction's type and colour, and the assigned composition, navigation and motion, are all visibly there, not just one of them. |
| Typography | The assigned faces really render, with strong scale contrast and a hierarchy you can read from across the room; no default faces. |
| Colour | A clear colour logic with intent behind the ground, contrast of 4.5:1 or better for text, no decorative gradients. |
| Layout and composition | A composition you have not seen on another site in this niche; no kicker, headline, sub-line and button stack; no copy left with a panel right. |
| Copy specificity | Names the real service, place and next step in the firm's own terms, from an angle the other two concepts do not use; nothing vague, nothing invented. |
| Imagery and brand | Art-directed imagery or a confident graphic idea; the client's logo used correctly; no stock tropes and nothing that merely fills a box. |
| Craft and interaction | Motion with one authored moment, working interactive parts, visible focus, nothing clipped or broken at 390px or 1440px. |

The critic also answers one yes-or-no question: would you put this in front of the client today, alongside work from the best design agency you know? A no sends the concept back, whatever its score.

The file has one section per concept:

```
## concept-a
Direction: <the direction id>
Saw: <one thing visible in the desktop screenshot and one in the phone screenshot>
Score: <total>/40
Scores: idea <n>, direction <n>, type <n>, colour <n>, layout <n>, copy <n>, imagery <n>, craft <n>
Present: <yes or no>
Slop: <anti-patterns and clichés found, with where; or None>
Fix: <the single biggest gap first, then the changes that would close it>
```

The build review adds one line after its verdict: `Design score: <total>/40`.
