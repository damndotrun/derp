-- Minta modul: egysoros üdvözlő szöveg (a modul saját táblái `example_` előtagúak).
CREATE TABLE example_greeting (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  text text NOT NULL
);
