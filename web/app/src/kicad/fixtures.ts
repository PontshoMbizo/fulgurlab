// Hand-written .kicad_sym fixtures for kicad.test.ts. These are ORIGINAL
// works authored for this port's own tests -- not extracted from any real
// KiCad library -- but are syntactically faithful to what KiCad 7's symbol
// editor actually writes (property blocks, pin_numbers/pin_names tokens,
// "Name_0_1" unit sub-symbols, effects blocks), so the parser is exercised
// against realistic structure rather than a hand-simplified toy grammar.
//
// Geometry is deliberately chosen so every pin TIP lands on an exact
// multiple of 2.54mm (the KiCad 100-mil pin grid), which after toWorld()'s
// 16/2.54 scale factor lands on an exact multiple of 16 world units (the
// canvas snap grid) -- see kicad.test.ts's coordinate assertions, and
// kicadSym.ts's pinTip() comment for the worked proof of which direction
// `rot` points a pin's tip relative to its `at` connection point.

// Fixture:R -- a resistor-like 2-pin symbol. Body is a 2.54mm x 5.08mm
// rectangle from (-1.27, 2.54) to (1.27, -2.54). Pin 1 ("~", passive) is the
// top connection point at (0, 3.81) rot 270, length 1.27 -- tip lands at
// (0, 2.54), exactly on the rectangle's top edge. Pin 2 mirrors it at the
// bottom: (0, -3.81) rot 90, length 1.27, tip at (0, -2.54).
export const FIXTURE_RESISTOR = `(kicad_symbol_lib (version 20211014) (generator kicad_symbol_editor)
  (symbol "Fixture:R" (pin_numbers hide) (pin_names (offset 0.254)) (in_bom yes) (on_board yes)
    (property "Reference" "R" (at 2.032 0 90)
      (effects (font (size 1.27 1.27)))
    )
    (property "Value" "R" (at -2.032 0 90)
      (effects (font (size 1.27 1.27)))
    )
    (property "Footprint" "" (at 0 0 0)
      (effects (font (size 1.27 1.27)) hide)
    )
    (property "Datasheet" "" (at 0 0 0)
      (effects (font (size 1.27 1.27)) hide)
    )
    (symbol "R_0_1"
      (rectangle (start -1.27 2.54) (end 1.27 -2.54)
        (stroke (width 0.254) (type default))
        (fill (type none))
      )
    )
    (symbol "R_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27)
        (name "~" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27))))
      )
      (pin passive line (at 0 -3.81 90) (length 1.27)
        (name "~" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27))))
      )
    )
  )
)
`;

// Fixture:IC4 -- a 4-pin IC-style symbol. Body is a 10.16mm x 5.08mm
// rectangle from (-5.08, 2.54) to (5.08, -2.54). Two pins enter from the
// left (rot 0, tip points +X into the body) and two from the right (rot
// 180, tip points -X into the body), each on the 2.54mm grid:
//   Pin 1 "VIN"  at (-7.62,  1.27) rot 0   tip (-5.08,  1.27)
//   Pin 2 "GND"  at (-7.62, -1.27) rot 0   tip (-5.08, -1.27)
//   Pin 3 "VOUT" at ( 7.62,  1.27) rot 180 tip ( 5.08,  1.27)
//   Pin 4 "EN"   at ( 7.62, -1.27) rot 180 tip ( 5.08, -1.27)
export const FIXTURE_IC4 = `(kicad_symbol_lib (version 20211014) (generator kicad_symbol_editor)
  (symbol "Fixture:IC4" (pin_names (offset 0.254)) (in_bom yes) (on_board yes)
    (property "Reference" "U" (at -5.08 3.81 0)
      (effects (font (size 1.27 1.27)) (justify left))
    )
    (property "Value" "IC4" (at -5.08 -3.81 0)
      (effects (font (size 1.27 1.27)) (justify left))
    )
    (property "Footprint" "" (at 0 0 0)
      (effects (font (size 1.27 1.27)) hide)
    )
    (property "Datasheet" "" (at 0 0 0)
      (effects (font (size 1.27 1.27)) hide)
    )
    (symbol "IC4_0_1"
      (rectangle (start -5.08 2.54) (end 5.08 -2.54)
        (stroke (width 0.254) (type default))
        (fill (type background))
      )
    )
    (symbol "IC4_1_1"
      (pin power_in line (at -7.62 1.27 0) (length 2.54)
        (name "VIN" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27))))
      )
      (pin power_in line (at -7.62 -1.27 0) (length 2.54)
        (name "GND" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27))))
      )
      (pin output line (at 7.62 1.27 180) (length 2.54)
        (name "VOUT" (effects (font (size 1.27 1.27))))
        (number "3" (effects (font (size 1.27 1.27))))
      )
      (pin input line (at 7.62 -1.27 180) (length 2.54)
        (name "EN" (effects (font (size 1.27 1.27))))
        (number "4" (effects (font (size 1.27 1.27))))
      )
    )
  )
)
`;
