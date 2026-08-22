from fizzbuzz import fizzbuzz

def test_empty():
    assert fizzbuzz(0) == []

def test_fifteen():
    got = fizzbuzz(15)
    assert got[0] == 1
    assert got[2] == "Fizz"
    assert got[4] == "Buzz"
    assert got[14] == "FizzBuzz"
    assert len(got) == 15
