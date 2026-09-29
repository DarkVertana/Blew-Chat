package auth

// commonPasswords is a small denylist of the most frequently breached
// passwords. The length and character-class rules already reject most of
// these; the list catches "Password123!"-style variants of them.
var commonPasswords = map[string]bool{}

func init() {
	for _, p := range []string{
		"password", "passw0rd", "p@ssw0rd", "p@ssword", "passwort", "password1", "password123",
		"123456", "1234567", "12345678", "123456789", "1234567890", "12345", "123123", "111111",
		"000000", "654321", "abc123", "abcd1234", "qwerty", "qwerty123", "qwertyuiop", "asdfghjkl",
		"zxcvbnm", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "letmein", "welcome", "welcome1", "admin",
		"administrator", "adminadmin", "root", "toor", "test", "test1234", "guest", "default",
		"changeme", "secret", "iloveyou", "monkey", "dragon", "football", "baseball", "soccer",
		"hockey", "sunshine", "princess", "master", "shadow", "superman", "batman", "starwars",
		"pokemon", "michael", "jennifer", "jessica", "ashley", "nicole", "daniel", "charlie",
		"thomas", "robert", "andrew", "matthew", "george", "donald", "trustno1", "whatever",
		"freedom", "computer", "internet", "hello123", "login", "jordan", "hunter", "mustang",
		"ranger", "harley", "buster", "killer", "pepper", "summer", "winter", "cheese", "tigger",
		"corvette", "mercedes", "ginger", "bailey", "maggie", "chelsea", "access", "flower",
		"cookie", "samsung", "google", "facebook", "blink182", "liverpool", "arsenal", "chelsea1",
	} {
		commonPasswords[p] = true
	}
}
