# Brand brief

## The product in one line

VBT lets anyone follow a ballot from cast to certified, with proof at every stage, without ever revealing who cast it or how it was voted.

## Who uses it

| Who | Where they are | What they need |
| --- | --- | --- |
| A voter | On a phone, minutes after voting or weeks later, holding a paper slip | One answer: where is my ballot, and is it intact? |
| A curious citizen or reporter | On a laptop, skeptical | To check any code and download the record to verify it themselves |
| A poll worker | At a precinct on election night, tired, under time pressure | To move a whole precinct forward in one confident action |
| A county official | At a desk, accountable for every change | Dense views, reasons on every exception, nothing irreversible by accident |

## How it should feel

A best-in-class modern utility: the calm confidence of a good banking or shipment-tracking app. Quick to answer, generous with space for voters, precise and dense for officials. Proof is available in one tap but never pushed at someone who just wants the status.

Three words: **calm, exact, open.**

- **Calm.** Status first, plain words, one task per screen. A worried voter should feel settled within two seconds.
- **Exact.** Every claim is specific: which stage, which county, which date, which record. No vague reassurance.
- **Open.** The proof is always one step away and anyone can check it. We show our work.

## What it must never feel like

- **A government website.** No GOV.UK, USWDS or Login.gov patterns, no Public Sans, no seal-and-banner header, no wall of links. VBT will run on a county's domain one day, but it should feel like a product people choose.
- **Data journalism.** No election-night maps, horse-race charts or vote shares in the voter view. A ballot tracker shows a ballot's journey, not results.
- **A crypto product.** No neon, no hex dumps up front, no "blockchain". Hashes live behind "See the proof".
- **Alarming.** Challenged and discarded states are calm, specific and give the reason and the next step.

## Visual identity

| Element | Decision |
| --- | --- |
| Color | Navy `#14213D` for ink and dark surfaces, warm paper `#F6F4EE` for the page, orange `#E07A2E` as the one accent |
| Type | Instrument Sans for everything; JetBrains Mono for tracking codes and hashes so 0/O and 1/l/I never get confused |
| Base library | shadcn/ui, restyled entirely through our tokens |
| Surfaces | Soft elevated cards with no hard borders; one dark navy hero card per screen at most |
| Signature | The stage timeline: four dots on a line, the current stage in orange |
| Receipt | A wallet-style pass on screen; a plain, high-contrast slip on paper |
| Badges | A colored dot plus the word, never color alone |
| Admin batch actions | A floating dark pill that appears when rows are selected |

## Voice

Plain, warm and specific. We write like a helpful clerk who knows the process cold.

- Say what happened, to whom, and when: "Marion County included your ballot in its election-night results on Nov 3."
- Name the next step and when to expect it: "Certification is usually within two weeks."
- Never promise more than the system proves: "Your encrypted ballot is unchanged," not "Your vote is safe."

## The floor

WCAG 2.2 AA is the minimum for every screen and every state, checked by script for color and by keyboard and screen reader for everything else.
