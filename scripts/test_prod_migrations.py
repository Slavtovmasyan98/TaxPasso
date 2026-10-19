import unittest
from prod_migrations import BASE, LEGACY, NEW, classify, validate_connection, pending_for_release, APPLIED


class ProductionGuards(unittest.TestCase):
    def test_known_histories(self):
        self.assertEqual(classify(LEGACY), "legacy")
        for n in range(len(NEW) + 1):
            self.assertEqual(classify(BASE + NEW[:n]), "normalized")

    def test_unknown_or_partial_history_stops(self):
        for versions in [[], LEGACY[:-1], BASE[:-1], BASE + ["012"], BASE + ["016"], BASE + NEW[:5] + ["017"], BASE + NEW + ["026"], BASE + ["001"], LEGACY + BASE]:
            with self.subTest(versions=versions), self.assertRaises(SystemExit):
                classify(versions)

    def test_release_025_only(self):
        self.assertEqual(NEW[-1], "025")
        self.assertEqual(APPLIED, [f"{i:03}" for i in range(1, 25)])
        self.assertEqual(pending_for_release(APPLIED), ["025"])
        self.assertEqual(pending_for_release(APPLIED + ["025"]), [])
        for versions in [BASE, APPLIED[:-1], APPLIED + ["026"]]:
            with self.subTest(versions=versions), self.assertRaises(SystemExit):
                pending_for_release(versions)

    def test_production_connection(self):
        validate_connection("postgresql://postgres:test@db.mhjxjxteorjwkvqbznfl.supabase.co:5432/postgres")
        validate_connection("postgresql://postgres.mhjxjxteorjwkvqbznfl:test@aws-0-eu-central-1.pooler.supabase.com:5432/postgres")

    def test_other_destinations_stop(self):
        for url in [
            "postgresql://postgres:mhjxjxteorjwkvqbznfl@wrong.example:5432/postgres",
            "postgresql://postgres:test@db.dgkiolejzgefzekunlnn.supabase.co:5432/postgres",
            "postgresql://postgres:test@db.mhjxjxteorjwkvqbznfl.supabase.co:6543/postgres",
            "postgresql://postgres:test@db.mhjxjxteorjwkvqbznfl.supabase.co:5432/other",
            "postgresql://postgres:test@db.mhjxjxteorjwkvqbznfl.supabase.co:5432/postgres?host=wrong.example",
        ]:
            with self.subTest(url=url), self.assertRaises(SystemExit):
                validate_connection(url)


if __name__ == "__main__":
    unittest.main()

