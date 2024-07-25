import nock from 'nock';

before(async () => {
	nock.disableNetConnect();
});
