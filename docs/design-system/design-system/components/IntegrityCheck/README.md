# IntegrityCheck

A card under each stage proving the encrypted ballot is unchanged and included in that stage's signed public record.

- **Consumer provides:** pass or mismatch, the record name, a short fingerprint, and a link to the independent verifier.
- Header row: a 36px icon circle (shield-check on `stage-done`, or X on `status-discarded-bg`), a bold one-line result, and a StatusBadge ("Verified" or "Mismatch").
- Then one muted sentence, the fingerprint in a copyable `surface-sunk` chip (mono, groups of four, shortened with an ellipsis), and a "Verify it yourself" link with an arrow.
- Verified is `ink`, never green. A mismatch uses `role="alert"` and always says what happens next: the ballot is Challenged, officials review it, the paper ballot decides.
