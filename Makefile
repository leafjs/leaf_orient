all: test
test:
	@NODE_ENV=test DEBUG=leaf* ./node_modules/.bin/istanbul cover ./node_modules/.bin/_mocha -- --compilers js:babel-register --reporter dot test
.PHONY: test