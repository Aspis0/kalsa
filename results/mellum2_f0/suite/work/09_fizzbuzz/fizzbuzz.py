def fizzbuzz(n):
    """Return a list of length n for i = 1..n:
    'FizzBuzz' if i is divisible by 15,
    'Fizz' if divisible by 3,
    'Buzz' if divisible by 5,
    otherwise the integer i itself.
    n == 0 returns [].
    """
    result = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            result.append("FizzBuzz")
        elif i % 3 == 0:
            result.append("Fizz")
        elif i % 5 == 0:
            result.append("Buzz")
        else:
            result.append(i)
    return result
