# Explainer

Short, plain answers to the questions a voter has on the tracker: what this is, why it's private, what happens next.

**Mode:** voter.

## When to use

At the bottom of the tracker and on the receipt view. Also inline, as a single expandable question, next to a status that tends to worry people (Under review, Not counted).

## Anatomy

- Section heading in `title`: "How this works".
- An accordion of questions in `body-lg` weight 600, answers in `body-lg`, inside one `surface-raised` card with `line` dividers between items.
- Optional small illustration per answer: a single-color line drawing in `ink` with an `accent-mark` highlight. Never stock photos.

## Standard questions

Write answers at about a sixth-grade reading level, two to four sentences each.

1. **Can anyone see how I voted?** No. The code tracks an encrypted ballot. Nobody, including you, can use it to prove how you voted.
2. **Is it safe to share my code?** Yes. Sharing or posting it proves nothing about your vote.
3. **What if I lose my slip?** The code can't be recovered. That's on purpose: we never link a code to a person.
4. **What do the stages mean?** One line per stage of the StageTimeline.
5. **Why is my ballot under review?** Reviews happen when records don't match. Most end with the ballot counted, and the reason is shown here.
6. **Is the paper ballot still what counts?** Yes. The paper ballot in the box decides recounts. This tracker is a transparency layer on top.
7. **How can I check this myself?** Download the public record and run the independent verifier.

## Behavior

- All items collapsed by default except when opened from an inline link, which expands and scrolls to that item.
- Multiple items can be open at once.
- Answers link to proof (IntegrityCheck) or the record download where relevant.

## Accessibility

- Built on shadcn's Accordion (Radix): headers are `button`s inside headings with `aria-expanded`.
- Heading levels continue the page outline (`h2` section, `h3` questions).
- No content is hidden from search or the find-in-page function when expanded.

## Acceptance checks

- [ ] All seven standard questions present with plain answers.
- [ ] Opening from an inline link lands on and expands the right item.
- [ ] Keyboard: Tab between questions, Enter or Space toggles.
- [ ] No answer claims more than the system proves.
