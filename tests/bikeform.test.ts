// Bike form <-> persisted BikeRevision (SPEC 9): reopening must restore the mechanic's own values.
import { describe, expect, it } from "vitest";
import {
  applySuggestion, BIKE_FIELDS, bikeFormFromRevision, bikeRevisionFromForm, confirmBike, editField, emptyBikeForm, unknownBike,
} from "@/lib/bikeForm";
import { BikeRevision } from "@/lib/contracts";

const suggestion = { ...unknownBike(), make: "Harley-Davidson", model: "Sportster", family: "sportster" as const, confidence: 0.7 };

describe("bikeFormFromRevision", () => {
  it("a confirmed bike is the mechanic's own: a late suggestion cannot overwrite it", () => {
    let form = editField(emptyBikeForm(), "make", "Triumph");
    form = confirmBike(form)!;
    const saved = bikeRevisionFromForm(form, "rev-1", 1234);
    const reopened = bikeFormFromRevision(BikeRevision.parse({ ...saved, id: crypto.randomUUID() }));
    expect(reopened.confirmed).toBe(true);
    expect(reopened.bike.make).toBe("Triumph");
    expect(reopened.touched.size).toBe(BIKE_FIELDS.length);
    expect(applySuggestion(reopened, suggestion).bike.make).toBe("Triumph");
  });

  it("a project that was never confirmed still accepts a cached suggestion", () => {
    const fresh = bikeRevisionFromForm(emptyBikeForm(), crypto.randomUUID(), 5);
    const reopened = bikeFormFromRevision(BikeRevision.parse(fresh));
    expect(reopened.confirmed).toBe(false);
    expect(applySuggestion(reopened, suggestion).bike.make).toBe("Harley-Davidson");
  });

  it("the saved record is valid, carries the revision, and has a date only when confirmed", () => {
    const confirmed = confirmBike(editField(emptyBikeForm(), "model", "XS650"))!;
    const rec = BikeRevision.parse(bikeRevisionFromForm(confirmed, crypto.randomUUID(), 99));
    expect(rec).toMatchObject({ confirmed: true, revision: 1, confirmedAt: 99 });
    expect(bikeRevisionFromForm(emptyBikeForm(), crypto.randomUUID(), 99).confirmedAt).toBeNull();
  });
});
